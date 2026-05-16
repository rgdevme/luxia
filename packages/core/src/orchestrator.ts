import fs from "node:fs/promises";
import path from "node:path";
import type {
  AgentPlugin,
  AgentReplayState,
  AgnosConfig,
  MaterializeContext,
  ResolveContext,
  ResolvedMcp,
  ResolvedRule,
  ResolvedSkill,
} from "./types/public.js";
import {
  type PluginRegistry,
  type RegisteredAgent,
  refToId,
  resolveAgentByRef,
} from "./plugin-loader.js";
import { buildPaths } from "./paths.js";
import { ensureSymlinkPrivileges, rebuildContextWithCopyFallback } from "./context.js";
import {
  isAgentInstalled,
  isDomainInitialized,
  markAgentInstalled,
  markDomainInitialized,
  readState,
  unmarkAgentInstalled,
  writeState,
  type AgnosState,
} from "./state.js";
import { activeAgents } from "./events.js";

export interface InstallOptions {
  copyOnNoSymlink?: boolean;
  interactive?: boolean;
}

export interface InstallResult {
  ok: boolean;
}

/**
 * The canonical state-reinstatement flow. Fired by `agnos init`, `agnos install`,
 * and (with a filter) by `agnos agents` for newly-selected agents.
 *
 * 1. Initialize newly-detected domains.
 * 2. Install newly-encountered agents.
 * 3. Activate + replay every agent in `targetAgents`.
 * 4. Reconcile orphans.
 */
export async function reinstate(
  config: AgnosConfig,
  registry: PluginRegistry,
  ctx: ResolveContext,
  opts: InstallOptions = {},
): Promise<InstallResult> {
  if (registry.collisions.length > 0) {
    for (const c of registry.collisions) {
      ctx.logger.error(
        `${c.type} id "${c.id}" is declared by multiple packages: ${c.packages.join(", ")}. ` +
          `Disambiguate in agnos.json.agents via { id, package }.`,
      );
    }
    return { ok: false };
  }

  const agents = activeAgents(config, registry, ctx);

  // Symlink privilege probe (fail-or-prompt before any agent attempts to write links).
  const needsFile = computeFileSymlinkNeed(config, agents);
  const needsDir = computeDirSymlinkNeed(config, agents);
  const decision = await ensureSymlinkPrivileges(
    ctx,
    { fileSymlinks: needsFile, dirSymlinks: needsDir },
    { interactive: opts.interactive ?? true, autoCopy: opts.copyOnNoSymlink ?? false },
  );
  if (!decision.proceed) return { ok: false };
  let runCtx = decision.copyFallback ? rebuildContextWithCopyFallback(ctx) : ctx;

  let state = await readState(runCtx.statePath);

  // 1) Domain onInitialize — once per project (per state.json).
  for (const dom of registry.domains.values()) {
    if (isDomainInitialized(state, dom.plugin.name)) continue;
    if (dom.plugin.onInitialize) {
      runCtx.logger.info(`-> ${dom.plugin.name}.onInitialize`);
      try {
        await dom.plugin.onInitialize(runCtx);
      } catch (err) {
        runCtx.logger.error(`${dom.plugin.name}.onInitialize failed: ${(err as Error).message}`);
        return { ok: false };
      }
    }
    state = markDomainInitialized(state, dom.plugin.name);
    await writeState(runCtx.statePath, state);
  }

  // 2) Agent onInstalled — once per agent (per state.json).
  for (const agent of agents) {
    if (isAgentInstalled(state, agent.id)) continue;
    if (agent.onInstalled) {
      runCtx.logger.info(`-> ${agent.id}.onInstalled`);
      try {
        await agent.onInstalled(runCtx);
      } catch (err) {
        runCtx.logger.error(`${agent.id}.onInstalled failed: ${(err as Error).message}`);
        return { ok: false };
      }
    }
    state = markAgentInstalled(state, agent.id);
    await writeState(runCtx.statePath, state);
  }

  // 3) Activate + replay each agent.
  const replayState = await buildAgentReplayState(config, runCtx);
  for (const agent of agents) {
    const mctx: MaterializeContext = { ...runCtx, agentId: agent.id };
    if (agent.onActivated) {
      runCtx.logger.info(`-> ${agent.id}.onActivated`);
      try {
        await agent.onActivated(mctx);
      } catch (err) {
        runCtx.logger.error(`${agent.id}.onActivated failed: ${(err as Error).message}`);
        return { ok: false };
      }
    }
    if (agent.onReplay) {
      runCtx.logger.info(`-> ${agent.id}.onReplay`);
      try {
        await agent.onReplay(replayState, mctx);
      } catch (err) {
        runCtx.logger.error(`${agent.id}.onReplay failed: ${(err as Error).message}`);
        return { ok: false };
      }
    }
  }

  // 4) Reconcile orphans on disk.
  await reconcile(config, agents, runCtx);

  runCtx.logger.success("install complete");
  return { ok: true };
}

/**
 * Deactivate one agent: fire onDeactivated. The agent's own handler is
 * responsible for removing the files it created. Caller decides whether to
 * also fire onUninstalled (for `agnos agent remove`) or leave it installed.
 */
export async function deactivateAgent(agent: AgentPlugin, ctx: ResolveContext): Promise<void> {
  if (!agent.onDeactivated) return;
  const mctx: MaterializeContext = { ...ctx, agentId: agent.id };
  ctx.logger.info(`-> ${agent.id}.onDeactivated`);
  await agent.onDeactivated(mctx);
}

/** Fire onUninstalled and remove the agent from state.installedAgents. */
export async function uninstallAgent(agent: AgentPlugin, ctx: ResolveContext): Promise<void> {
  if (agent.onUninstalled) {
    const mctx: MaterializeContext = { ...ctx, agentId: agent.id };
    ctx.logger.info(`-> ${agent.id}.onUninstalled`);
    await agent.onUninstalled(mctx);
  }
  const state = await readState(ctx.statePath);
  await writeState(ctx.statePath, unmarkAgentInstalled(state, agent.id));
}

/**
 * Resolve the project's current state into a structure the agent's onReplay
 * can consume.
 */
export async function buildAgentReplayState(
  config: AgnosConfig,
  ctx: ResolveContext,
): Promise<AgentReplayState> {
  const out: AgentReplayState = { mcp: [], skills: [] };
  if (config.rules) {
    out.rules = await resolveRule(config.rules.source, ctx);
  }
  for (const mcp of config.mcp ?? []) {
    out.mcp.push({ ...mcp });
  }
  for (const s of config.skills ?? []) {
    const dir = path.join(buildPaths(ctx.projectRoot).skillsDir, s.name);
    out.skills.push({ name: s.name, absolutePath: dir });
  }
  return out;
}

export async function resolveRule(source: string, ctx: ResolveContext): Promise<ResolvedRule> {
  return {
    absolutePath: path.resolve(ctx.projectRoot, source),
    relativeSource: source,
  };
}

export async function resolveSkill(name: string, ctx: ResolveContext): Promise<ResolvedSkill> {
  return {
    name,
    absolutePath: path.join(buildPaths(ctx.projectRoot).skillsDir, name),
  };
}

/**
 * Orphan cleanup. Runs after install / agent operations. Does NOT dispatch
 * events — it acts directly on the filesystem so we don't re-fire events
 * during cleanup.
 */
export async function reconcile(
  config: AgnosConfig,
  agents: AgentPlugin[],
  ctx: ResolveContext,
): Promise<void> {
  const paths = buildPaths(ctx.projectRoot);
  const declaredSkills = new Set((config.skills ?? []).map((s) => s.name));

  // 1) .agnos/skills/<x> not declared → delete.
  await pruneSkillsDir(paths.skillsDir, declaredSkills, ctx);

  // 2) For each active agent: prune any per-agent skill dir entries not declared.
  for (const agent of agents) {
    const dir = agentSkillDir(agent.id, ctx.projectRoot);
    if (!dir) continue;
    await pruneSkillsDir(dir, declaredSkills, ctx, /* skipMissingDir */ true);
  }
  // Rules link reconciliation is left to the per-event handlers — `onReplay`
  // is invoked elsewhere and rewrites the link from current state. MCP files
  // are entirely rewritten by `onReplay`, so no separate pass is needed.
}

async function pruneSkillsDir(
  dir: string,
  declared: ReadonlySet<string>,
  ctx: ResolveContext,
  skipMissingDir = false,
): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if (skipMissingDir && (err as NodeJS.ErrnoException).code === "ENOENT") return;
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  for (const name of entries) {
    if (declared.has(name)) continue;
    const full = path.join(dir, name);
    await fs.rm(full, { recursive: true, force: true });
    ctx.logger.info(`reconcile: removed orphan ${path.relative(ctx.projectRoot, full)}`);
  }
}

/**
 * Returns the agent's skill directory, or undefined if the agent doesn't
 * surface skills as a directory of links. Currently hardcoded; could become
 * a method on AgentPlugin if more agents support skills.
 */
function agentSkillDir(agentId: string, projectRoot: string): string | undefined {
  if (agentId === "claude-code") return path.join(projectRoot, ".claude", "skills");
  return undefined;
}

function computeFileSymlinkNeed(config: AgnosConfig, agents: AgentPlugin[]): boolean {
  if (agents.length === 0) return false;
  const rulesSource = config.rules?.source ?? "./AGENTS.md";
  const isDefault = normalize(rulesSource) === "./AGENTS.md";
  for (const a of agents) {
    if (a.id === "claude-code") return true;
    if (a.id === "codex" && !isDefault) return true;
  }
  return false;
}

function computeDirSymlinkNeed(config: AgnosConfig, agents: AgentPlugin[]): boolean {
  if (!config.skills?.length) return false;
  return agents.some((a) => a.id === "claude-code");
}

function normalize(p: string): string {
  const trimmed = p.replace(/\\/g, "/");
  return trimmed.startsWith("./") ? trimmed : `./${trimmed}`;
}

// Re-export for command modules
export { resolveAgentByRef, refToId };
export type { RegisteredAgent };
