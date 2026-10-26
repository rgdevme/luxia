import type { DomainRunOptions, RunContext } from "./types/public.js";
import { withDomain } from "./logger.js";
import { orderedDomains, type PluginRegistry, type RegisteredDomain } from "./plugin-loader.js";

async function runDomain(
  dom: RegisteredDomain,
  opts: DomainRunOptions,
  ctx: RunContext,
): Promise<void> {
  if (!dom.domain.run) return;
  // Scope the logger to this domain so everything it prints carries the
  // domain's `[domain]` prefix and color automatically.
  const scoped: RunContext = { ...ctx, logger: withDomain(ctx.logger, dom.domain) };
  try {
    await dom.domain.run(opts, scoped);
  } finally {
    await scoped.fetcher.cleanup?.();
  }
}

/**
 * Run every domain whose priority is `>= fromPriority`, in ascending priority
 * order. Used by the watch supervisor to cascade: a change under a domain's
 * watched paths re-runs that domain and everything downstream of it (e.g. a doc
 * edit re-runs `docs → rules → harness`). Writer domains with no `run` are
 * skipped along the way.
 */
export async function runFrom(
  registry: PluginRegistry,
  fromPriority: number,
  opts: DomainRunOptions,
  ctx: RunContext,
): Promise<{ ok: boolean }> {
  let ok = true;
  for (const dom of orderedDomains(registry)) {
    if (dom.domain.priority < fromPriority) continue;
    try {
      await runDomain(dom, opts, ctx);
    } catch (error) {
      ok = false;
      ctx.logger.error(`${dom.domain.id} failed: ${(error as Error).message}`);
    }
  }
  return { ok };
}

/**
 * Run every domain's process in priority order — the run pipeline
 * `skills-resolve → docs-compile → rules-generate → harness-render`. Writer
 * domains with no `run` (mcp) are skipped; the harness domain (highest
 * priority) renders last from the canonical outputs the others produced.
 */
export async function runAll(
  registry: PluginRegistry,
  opts: DomainRunOptions,
  ctx: RunContext,
): Promise<{ ok: boolean }> {
  return await runFrom(registry, Number.NEGATIVE_INFINITY, opts, ctx);
}

/** Run a single domain's process by id. */
export async function runOne(
  registry: PluginRegistry,
  id: string,
  opts: DomainRunOptions,
  ctx: RunContext,
): Promise<{ ok: boolean }> {
  const dom = registry.domains.get(id);
  if (!dom) throw new Error(`unknown domain "${id}"`);
  try {
    await runDomain(dom, opts, ctx);
    return { ok: true };
  } catch (error) {
    ctx.logger.error(`${dom.domain.id} failed: ${(error as Error).message}`);
    return { ok: false };
  }
}
