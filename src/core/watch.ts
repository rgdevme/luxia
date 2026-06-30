import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import type { DomainRunOptions, RunContext } from "./types/public.js";
import { readConfigOrDefault } from "./config.js";
import { orderedDomains, type PluginRegistry, type RegisteredDomain } from "./plugin-loader.js";
import { runFrom, runOne } from "./run.js";

const DEBOUNCE_MS = 150;
const AWAIT_WRITE_FINISH = { stabilityThreshold: 150, pollInterval: 50 } as const;

/**
 * Watch supervisor — a per-domain watcher tree (§13.4). After the initial paint
 * it watches each domain's declared content paths plus `agnos.json`, and on a
 * change re-runs the affected domain and everything downstream of it, so
 * regenerated artifacts cascade (`docs → rules → agents`):
 *
 *   - docs   watches `docs.root` (its own index.md is ignored)
 *   - rules  watches the fragment files listed in `rules.files`
 *   - agents watches `agnos.json` (the config it renders from)
 *   - skills/mcp/hooks contribute no watcher — they are CLI-driven writers
 *
 * A change to `agnos.json` rebuilds the config-derived watch lists (a new
 * fragment / moved `docs.root` retargets without a restart) and re-runs from the
 * rules domain onward so the new config is injected and re-rendered. `domainId`
 * scopes the whole thing to one domain (and re-runs only that domain).
 */
export async function startWatch(
  registry: PluginRegistry,
  opts: DomainRunOptions,
  ctx: RunContext,
  domainId?: string,
  signal?: AbortSignal,
): Promise<void> {
  const scoped = domainId !== undefined;
  const inScope: RegisteredDomain[] = scoped
    ? (() => {
        const dom = registry.domains.get(domainId);
        if (!dom) throw new Error(`unknown domain "${domainId}"`);
        return [dom];
      })()
    : orderedDomains(registry);

  // Initial paint.
  await runScopedOrAll();

  // Serialized, coalescing re-run queue. `pendingFrom` is the lowest priority we
  // owe a re-run from; `pendingRebuild` means the config-derived watch lists need
  // rebuilding first. Events during an in-flight run fold into the next pass.
  let running = false;
  let pendingFrom = Number.POSITIVE_INFINITY;
  let pendingRebuild = false;

  const drain = (): void => {
    if (running) return;
    if (pendingFrom === Number.POSITIVE_INFINITY && !pendingRebuild) return;
    running = true;
    const from = pendingFrom;
    const rebuild = pendingRebuild;
    pendingFrom = Number.POSITIVE_INFINITY;
    pendingRebuild = false;
    void (async () => {
      try {
        if (rebuild) await rebuildContentWatchers();
        if (from !== Number.POSITIVE_INFINITY) {
          if (domainId) await runOne(registry, domainId, opts, ctx);
          else await runFrom(registry, from, opts, ctx);
        }
      } catch (err) {
        ctx.logger.error(`run failed: ${(err as Error).message}`);
      } finally {
        running = false;
        drain();
      }
    })();
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const request = (from: number, rebuild: boolean): void => {
    pendingFrom = Math.min(pendingFrom, from);
    pendingRebuild = pendingRebuild || rebuild;
    if (timer) clearTimeout(timer);
    timer = setTimeout(drain, DEBOUNCE_MS);
  };

  const eventLabel = (event: string): string =>
    event === "add" || event === "addDir"
      ? "added"
      : event === "unlink" || event === "unlinkDir"
        ? "removed"
        : "changed";

  // ---- content watchers (rebuilt when agnos.json changes) ----
  let contentWatchers: FSWatcher[] = [];

  async function rebuildContentWatchers(): Promise<void> {
    await Promise.all(contentWatchers.map((w) => w.close()));
    contentWatchers = [];
    const config = await readConfigOrDefault(ctx.configPath);
    for (const dom of inScope) {
      const paths = ((await dom.domain.watchPaths?.(config, ctx)) ?? []).filter(
        (p) => path.resolve(p) !== path.resolve(ctx.configPath),
      );
      if (paths.length === 0) continue;
      const ignore = ((await dom.domain.watchIgnore?.(config, ctx)) ?? []).map((p) =>
        path.resolve(p),
      );
      const watcher = chokidar.watch(paths, {
        ignoreInitial: true,
        awaitWriteFinish: AWAIT_WRITE_FINISH,
        ...(ignore.length > 0 ? { ignored: (p: string) => ignore.includes(path.resolve(p)) } : {}),
      });
      const from = dom.domain.priority;
      const onEvent = (event: string, file: string): void => {
        const rel = path.relative(ctx.projectRoot, file) || file;
        ctx.logger.info(`${rel} ${eventLabel(event)} — re-running ${dom.domain.id}…`);
        request(from, false);
      };
      watcher
        .on("add", (f) => onEvent("add", f))
        .on("change", (f) => onEvent("change", f))
        .on("unlink", (f) => onEvent("unlink", f));
      contentWatchers.push(watcher);
    }
  }

  await rebuildContentWatchers();

  // ---- config watcher ----
  // Always watch agnos.json (it determines the content watch lists and what the
  // agents domain renders) — except when scoped to docs, which by design is
  // independent of agnos.json.
  let configWatcher: FSWatcher | undefined;
  const watchConfig = !scoped || domainId !== "docs";
  if (watchConfig) {
    // Full mode: re-run from rules onward (rebuild + rules-inject + agents-render),
    // never docs. Scoped: re-run just the scoped domain.
    const cfgFrom =
      registry.domains.get("rules")?.domain.priority ??
      registry.domains.get("agents")?.domain.priority ??
      Number.POSITIVE_INFINITY;
    configWatcher = chokidar.watch(ctx.configPath, {
      ignoreInitial: true,
      awaitWriteFinish: AWAIT_WRITE_FINISH,
    });
    const scopedFrom = inScope[0]?.domain.priority ?? cfgFrom;
    const onConfig = (): void => {
      ctx.logger.info("agnos.json changed — re-running…");
      request(scoped ? scopedFrom : cfgFrom, true);
    };
    configWatcher.on("change", onConfig).on("add", onConfig).on("unlink", onConfig);
  }

  const watched = [...inScope.map((d) => d.domain.id)].join(", ");
  ctx.logger.info(`watching ${watched || "agnos.json"} (Ctrl-C to stop)`);

  await new Promise<void>((resolve) => {
    let done = false;
    const onSig = (): void => void stop();
    const stop = async (): Promise<void> => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      process.removeListener("SIGINT", onSig);
      process.removeListener("SIGTERM", onSig);
      const all = [...contentWatchers, configWatcher].filter(
        (w): w is FSWatcher => w !== undefined,
      );
      await Promise.all(all.map((w) => w.close()));
      resolve();
    };
    process.once("SIGINT", onSig);
    process.once("SIGTERM", onSig);
    if (signal?.aborted) void stop();
    else signal?.addEventListener("abort", () => void stop(), { once: true });
  });

  async function runScopedOrAll(): Promise<void> {
    try {
      if (domainId) await runOne(registry, domainId, opts, ctx);
      else await runFrom(registry, Number.NEGATIVE_INFINITY, opts, ctx);
    } catch (err) {
      ctx.logger.error(`run failed: ${(err as Error).message}`);
    }
  }
}
