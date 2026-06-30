import path from "node:path";
import type {
  AgentAdapter,
  AgnosConfig,
  CommandContext,
  CommandSpec,
  Domain,
  ExclusiveChoice,
  MaterializeContext,
  ResolveContext,
  ResolvedMcp,
} from "../../core/index.js";
import { buildPaths, createSpinner, readConfigOrDefault, writeConfig } from "../../core/index.js";
import { adapterById, ADAPTERS, DEFAULT_AGENT_IDS } from "../../agents/adapters/index.js";
import { removePaths } from "../../agents/adapters/shared.js";
import { multiSelectInteractive, writeChange } from "../cli-helpers.js";

const ADD_HINT =
  "pass agent ids to add (e.g. `agnos agents add claude-code`) — interactive selection needs a TTY";
const REMOVE_HINT =
  "pass agent ids to remove (e.g. `agnos agents remove codex`) — interactive selection needs a TTY";

const AGENTS_ARG = {
  name: "agents",
  required: false,
  variadic: true,
  description: "agent ids (claude-code | codex); omit to pick interactively",
} as const;

function agentDescription(adapter: AgentAdapter): string | undefined {
  const file = adapter.paths?.rulesFilename;
  return file ? `writes ${file}` : undefined;
}

function unknownAgentError(ids: string[]): Error {
  const plural = ids.length > 1 ? "s" : "";
  return new Error(
    `unknown agent${plural} "${ids.join(", ")}" (known: ${ADAPTERS.map((a) => a.id).join(", ")})`,
  );
}

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
    description: "Enable agents (their files render on the next `agnos` run)",
    args: [AGENTS_ARG],
    async run(ctx) {
      const config = await readConfigOrDefault(ctx.configPath);
      const enabled = config.agents ?? [];
      let ids = ctx.args;
      if (ids.length === 0) {
        if (ADAPTERS.every((a) => enabled.includes(a.id))) {
          ctx.logger.info("all agents are already enabled");
          return;
        }
        // Already-enabled agents show dimmed and locked so the picker stays additive.
        const choices: ExclusiveChoice[] = ADAPTERS.map((a) => ({
          name: a.displayName,
          value: a.id,
          description: agentDescription(a),
          checked: enabled.includes(a.id),
          disabled: enabled.includes(a.id),
        }));
        ids = await multiSelectInteractive("Add agents:", choices, ADD_HINT);
      }
      const unknown = ids.filter((id) => !adapterById(id));
      if (unknown.length > 0) throw unknownAgentError(unknown);
      const toAdd = [...new Set(ids)].filter((id) => !enabled.includes(id));
      if (toAdd.length === 0) {
        ctx.logger.info("nothing to add");
        return;
      }
      const plural = toAdd.length > 1 ? "s" : "";
      await writeChange(ctx, `enabled agent${plural} "${toAdd.join(", ")}"`, {
        ...config,
        agents: [...enabled, ...toAdd],
      });
    },
  },
  remove: {
    name: "remove",
    description: "Remove agents' rendered files, then disable them",
    args: [AGENTS_ARG],
    async run(ctx) {
      const config = await readConfigOrDefault(ctx.configPath);
      const enabled = config.agents ?? [];
      let ids = ctx.args;
      if (ids.length === 0) {
        if (enabled.length === 0) {
          ctx.logger.info("no agents are enabled");
          return;
        }
        const choices: ExclusiveChoice[] = enabled.map((id) => {
          const adapter = adapterById(id);
          return {
            name: adapter?.displayName ?? id,
            value: id,
            description: adapter ? agentDescription(adapter) : undefined,
          };
        });
        ids = await multiSelectInteractive("Remove agents:", choices, REMOVE_HINT);
      }
      const targets = [...new Set(ids)];
      if (targets.length === 0) return;
      const notEnabled = targets.filter((id) => !enabled.includes(id));
      if (notEnabled.length > 0) throw new Error(`not enabled: ${notEnabled.join(", ")}`);
      // §13.2: delete each removed agent's owned files first, then edit the config.
      const remaining = enabled
        .filter((id) => !targets.includes(id))
        .map((id) => adapterById(id))
        .filter((a): a is AgentAdapter => Boolean(a));
      for (const id of targets) {
        const removed = adapterById(id);
        if (removed) await cleanupAgent(removed, remaining, { ...ctx, agentId: id, indent: "  " });
      }
      const plural = targets.length > 1 ? "s" : "";
      await writeChange(ctx, `removed agent${plural} "${targets.join(", ")}"`, {
        ...config,
        agents: enabled.filter((id) => !targets.includes(id)),
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
  initSteps: [
    {
      id: "select",
      type: "multiselect",
      message: "Which agents do you want to configure?",
      choices: ADAPTERS.map((a) => ({
        name: a.displayName,
        value: a.id,
        description: agentDescription(a),
      })),
      // Pre-check the current selection; on a fresh project fall back to the
      // curated default. Also the value written non-interactively (`-y`/`--dry`).
      default: async (ctx) => {
        const config = await readConfigOrDefault(ctx.configPath);
        const agents = config.agents ?? [];
        return agents.length > 0 ? agents : [...DEFAULT_AGENT_IDS];
      },
      async callback(ids, ctx) {
        const config = await readConfigOrDefault(ctx.configPath);
        await writeConfig(ctx.configPath, { ...config, agents: [...new Set(ids)] });
      },
    },
  ],
  commands,
  async run(opts, ctx) {
    const config = await readConfigOrDefault(ctx.configPath);
    const adapters = activeAdapters(config, ctx);
    if (adapters.length === 0) return undefined;
    const spinner = createSpinner("Materializing agent files", { quiet: opts.quiet });
    try {
      for (const adapter of adapters) {
        spinner.update(`Materializing ${adapter.displayName} agent's files`);
        await renderAgent(adapter, config, { ...ctx, agentId: adapter.id, indent: "  " });
      }
    } finally {
      spinner.stop();
    }
    return undefined;
  },
};

export { ADAPTERS };
