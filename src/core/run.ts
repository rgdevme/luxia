import type { DomainRunOptions, RunContext } from "./types/public.js";
import { orderedDomains, type PluginRegistry, type RegisteredDomain } from "./plugin-loader.js";

async function runDomain(
  dom: RegisteredDomain,
  opts: DomainRunOptions,
  ctx: RunContext,
): Promise<void> {
  if (!dom.domain.run) return;
  await dom.domain.run(opts, ctx);
}

/**
 * Run every domain's process in priority order — the run pipeline
 * `skills-prepare → docs-compile → rules-inject → agents-render`. Writer
 * domains with no `run` (mcp/hooks) are skipped; the agents domain (highest
 * priority) renders last from the canonical outputs the others produced.
 */
export async function runAll(
  registry: PluginRegistry,
  opts: DomainRunOptions,
  ctx: RunContext,
): Promise<void> {
  for (const dom of orderedDomains(registry)) {
    await runDomain(dom, opts, ctx);
  }
}

/** Run a single domain's process by id. */
export async function runOne(
  registry: PluginRegistry,
  id: string,
  opts: DomainRunOptions,
  ctx: RunContext,
): Promise<void> {
  const dom = registry.domains.get(id);
  if (!dom) throw new Error(`unknown domain "${id}"`);
  await runDomain(dom, opts, ctx);
}
