import chokidar from "chokidar";
import type { DomainRunOptions, RunContext } from "./types/public.js";
import type { PluginRegistry } from "./plugin-loader.js";
import { runAll, runOne } from "./run.js";

/**
 * Watch supervisor. Runs the pipeline once for the initial paint, then watches
 * `agnos.json` and re-runs (debounced) on change — the teardown→rebuild model
 * (§13.4) in its simplest form: any config change re-runs the whole pipeline so
 * the running state always matches the file. `domainId` scopes to one domain.
 */
export async function startWatch(
  registry: PluginRegistry,
  opts: DomainRunOptions,
  ctx: RunContext,
  domainId?: string,
): Promise<void> {
  const once = async (): Promise<void> => {
    try {
      if (domainId) await runOne(registry, domainId, opts, ctx);
      else await runAll(registry, opts, ctx);
    } catch (err) {
      ctx.logger.error(`run failed: ${(err as Error).message}`);
    }
  };

  await once();

  const watcher = chokidar.watch(ctx.configPath, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      ctx.logger.info("agnos.json changed — re-running…");
      void once();
    }, 150);
  };
  watcher.on("change", schedule).on("add", schedule).on("unlink", schedule);
  ctx.logger.info(`watching ${ctx.configPath} (Ctrl-C to stop)`);

  await new Promise<void>((resolve) => {
    const stop = async (): Promise<void> => {
      await watcher.close();
      resolve();
    };
    process.once("SIGINT", () => void stop());
    process.once("SIGTERM", () => void stop());
  });
}
