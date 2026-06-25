import path from "node:path";
import type {
  AgentAdapter,
  AgnosConfig,
  CommandContext,
  CommandSpec,
  Domain,
  MaterializeContext,
  ResolveContext,
  ResolvedMcp,
} from "../../core/index.js";
import { buildPaths, readConfigOrDefault } from "../../core/index.js";
import { adapterById, ADAPTERS } from "../../agents/adapters/index.js";
import { removePaths } from "../../agents/adapters/shared.js";
import { reqArg, writeChange } from "../cli-helpers.js";

/** The per-agent render slices, in dependency order. */
const SLICES = ["rules", "mcp", "hooks", "skills"] as const;

/**
 * Resolve the per-slice state the adapters render from. Reads the new-schema
 * config directly — this is the config-READER half of the writer/reader split.
 */
export function resolveSlices(config: AgnosConfig, ctx: ResolveContext): Record<string, unknown> {
  const hasSkills = Object.keys(config.skills?.sources ?? {}).length > 0;
  return {
    rules: Object.keys(config.rules?.files ?? {}),
    mcp: (config.mcp ?? []).map((m) => ({ ...m })) as ResolvedMcp[],
    hooks: config.hooks ?? [],
    // Empty string signals "no skills" → the adapter ensures the link is absent.
    skills: hasSkills ? buildPaths(ctx.projectRoot, config).skillsDir : "",
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
 * Scrape a slice ("mcp" | "hooks") from every active agent's native files —
 * the discovery half of `agnos <domain> migrate`. Lives here because this is
 * where the active adapters are resolved.
 */
export async function scrapeActive(
  slice: "mcp" | "hooks",
  ctx: CommandContext,
): Promise<unknown[]> {
  const config = await readConfigOrDefault(ctx.configPath);
  const out: unknown[] = [];
  for (const adapter of activeAdapters(config, ctx)) {
    const fn = adapter.scrape?.[slice];
    if (!fn) continue;
    const got = await fn({ ...ctx, agentId: adapter.id, indent: "" });
    if (Array.isArray(got)) out.push(...got);
  }
  return out;
}

const commands: Record<string, CommandSpec> = {
  add: {
    name: "add",
    description: "Enable an agent (its files render on the next `agnos` run)",
    args: [{ name: "agent", required: true, description: "agent id (claude-code | codex)" }],
    async run(ctx) {
      const id = reqArg(ctx, 0, "agent");
      if (!adapterById(id)) {
        throw new Error(`unknown agent "${id}" (known: ${ADAPTERS.map((a) => a.id).join(", ")})`);
      }
      const config = await readConfigOrDefault(ctx.configPath);
      const agents = config.agents ?? [];
      if (agents.includes(id)) {
        ctx.logger.info(`agent "${id}" is already enabled`);
        return;
      }
      await writeChange(ctx, `enabled agent "${id}"`, { ...config, agents: [...agents, id] });
    },
  },
  remove: {
    name: "remove",
    description: "Remove an agent's rendered files, then disable it",
    args: [{ name: "agent", required: true, description: "agent id" }],
    async run(ctx) {
      const id = reqArg(ctx, 0, "agent");
      const config = await readConfigOrDefault(ctx.configPath);
      const agents = config.agents ?? [];
      if (!agents.includes(id)) throw new Error(`agent "${id}" is not enabled`);
      // §13.2: delete the agent's owned files first, then edit the config.
      const removed = adapterById(id);
      if (removed) {
        const remaining = agents
          .filter((a) => a !== id)
          .map((a) => adapterById(a))
          .filter((a): a is AgentAdapter => Boolean(a));
        await cleanupAgent(removed, remaining, { ...ctx, agentId: id, indent: "  " });
      }
      await writeChange(ctx, `removed agent "${id}"`, {
        ...config,
        agents: agents.filter((a) => a !== id),
      });
    },
  },
};

/**
 * The agents domain: the sole config-reader. Highest priority so it renders
 * after every writer domain has produced its canonical outputs. `add`/`remove`
 * toggle `agnos.json#agents` (remove also cleans the agent's files); `run`
 * renders every active agent.
 */
export const agentsDomain: Domain = {
  id: "agents",
  description: "Render per-agent native files from agnos.json (the config reader)",
  kind: "reader",
  priority: 99,
  commands,
  async run(_opts, ctx) {
    const config = await readConfigOrDefault(ctx.configPath);
    for (const adapter of activeAdapters(config, ctx)) {
      await renderAgent(adapter, config, { ...ctx, agentId: adapter.id, indent: "  " });
    }
    return undefined;
  },
};

export { ADAPTERS };
