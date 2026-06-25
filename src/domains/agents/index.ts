import path from "node:path";
import type {
  AgentAdapter,
  AgnosConfig,
  Domain,
  MaterializeContext,
  ResolveContext,
  ResolvedMcp,
} from "../../core/index.js";
import { buildPaths } from "../../core/index.js";
import { adapterById, ADAPTERS } from "../../agents/adapters/index.js";
import { removePaths } from "../../agents/adapters/shared.js";

/** The per-agent render slices, in dependency order. */
const SLICES = ["rules", "mcp", "hooks", "skills"] as const;

/**
 * Resolve the per-slice state the adapters render from. Reads the new-schema
 * config directly — this is the config-READER half of the writer/reader split.
 */
export function resolveSlices(config: AgnosConfig, ctx: ResolveContext): Record<string, unknown> {
  return {
    rules: Object.keys(config.rules?.files ?? {}),
    mcp: (config.mcp ?? []).map((m) => ({ ...m })) as ResolvedMcp[],
    hooks: config.hooks ?? [],
    skills: buildPaths(ctx.projectRoot, config).skillsDir,
  };
}

/** Active agent adapters, from `agnos.json#agents` (unknown ids warn + skip). */
export function activeAdapters(config: AgnosConfig, ctx: ResolveContext): AgentAdapter[] {
  const out: AgentAdapter[] = [];
  for (const ref of config.agents ?? []) {
    const adapter = adapterById(ref);
    if (adapter) out.push(adapter);
    else ctx.logger.warn(`agents: unknown agent "${ref}" (skipped)`);
  }
  return out;
}

/**
 * Render one agent. §13.1: each slice is atomic — a slice failure warns with the
 * reason and continues to the next slice; it never aborts the agent or the run.
 */
export async function renderAgent(
  adapter: AgentAdapter,
  config: AgnosConfig,
  ctx: MaterializeContext,
): Promise<void> {
  const slices = resolveSlices(config, ctx);
  for (const slice of SLICES) {
    const fn = adapter.render?.[slice];
    if (!fn) continue;
    try {
      await fn(slices[slice], ctx);
    } catch (err) {
      ctx.logger.warn(`${adapter.id}: ${slice} render failed: ${(err as Error).message}`);
    }
  }
}

/**
 * Remove an agent's owned outputs on deactivation. §13.2: deletes only the
 * removed agent's claimed paths that no *remaining* agent also claims (shared
 * artifacts are kept). Canonical files are never claimed, so never deleted here.
 */
export async function cleanupAgent(
  removed: AgentAdapter,
  remaining: readonly AgentAdapter[],
  ctx: MaterializeContext,
): Promise<void> {
  const owned = removed.claims ? await removed.claims(ctx) : [];
  const kept = new Set<string>();
  for (const r of remaining) {
    if (!r.claims) continue;
    for (const p of await r.claims(ctx)) kept.add(path.resolve(p));
  }
  const toRemove = owned.filter((p) => !kept.has(path.resolve(p)));
  await removePaths(toRemove, ctx);
}

/**
 * The agents domain: the sole config-reader. Highest priority so it renders
 * after every writer domain has produced its canonical outputs. (CLI `run`
 * and `add`/`remove` commands are wired in M8; M3 provides the render/cleanup
 * machinery above, exercised by unit tests.)
 */
export const agentsDomain: Domain = {
  id: "agents",
  description: "Render per-agent native files from agnos.json (the config reader)",
  kind: "reader",
  priority: 99,
};

export { ADAPTERS };
