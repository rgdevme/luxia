import fs from "node:fs/promises";
import path from "node:path";
import type {
  AgentPlugin,
  AgnosConfig,
  DomainEventHandlers,
  MaterializeContext,
  ResolveContext,
  ResolvedMcp,
  ResolvedRule,
  ResolvedSkill,
} from "./types/public.js";
import {
  type PluginRegistry,
  type RegisteredAgent,
  type RegisteredDomain,
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
 * State reinstatement. Fired by `agnos install` (and by other commands when a
 * full rematerialization is needed). For each active agent, runs:
 *   - onInstalled (gated by state.json, once per local environment)
 *   - per-domain onInitialize, in domain priority order
 * Also calls domain.onInitialize once per project (gated by state.json) for
 * any newly-encountered domain.
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

  const runCtx = await ensurePrivileges(ctx, config, agents, opts);
  if (!runCtx) return { ok: false };

  // 1) Domain onInitialize (once per project).
  if (!(await initializeNewDomains(registry, runCtx))) return { ok: false };

  // 2) Per-agent onInstalled + per-domain onInitialize.
  for (const agent of agents) {
    if (!(await ensureAgentInstalled(agent, runCtx))) return { ok: false };
    try {
      await materializeAgent(agent, config, registry, runCtx);
    } catch (err) {
      runCtx.logger.error(`${agent.id} materialize failed: ${(err as Error).message}`);
      return { ok: false };
    }
  }

  // 3) Reconcile orphans.
  await reconcile(config, agents, runCtx);

  runCtx.logger.success("install complete");
  return { ok: true };
}

/**
 * Activate one agent (no full reinstate). Runs onInstalled if needed, then
 * per-domain onInitialize in priority order. Used by `agnos agents` and
 * `agnos agent add`.
 */
export async function activateAgent(
  agent: AgentPlugin,
  config: AgnosConfig,
  registry: PluginRegistry,
  ctx: ResolveContext,
): Promise<void> {
  if (!(await ensureAgentInstalled(agent, ctx))) {
    throw new Error(`onInstalled failed for ${agent.id}`);
  }
  await materializeAgent(agent, config, registry, ctx);
}

/**
 * Run per-domain onCleanup for an agent (in reverse priority order). Does
 * NOT modify agnos.json or state.json.
 */
export async function cleanupAgent(
  agent: AgentPlugin,
  registry: PluginRegistry,
  ctx: ResolveContext,
): Promise<void> {
  const mctx: MaterializeContext = { ...ctx, agentId: agent.id };
  for (const dom of orderedDomains(registry).reverse()) {
    const handlers = handlersFor(agent, dom.plugin.name);
    const fn = handlers?.onCleanup;
    if (!fn) continue;
    ctx.logger.info(`-> ${agent.id}.${dom.plugin.name}.onCleanup`);
    await fn(mctx);
  }
}

/**
 * Mark an agent uninstalled in state.json and fire onUninstalled (top-level).
 * Caller is responsible for calling cleanupAgent first if the agent was active.
 */
export async function uninstallAgent(agent: AgentPlugin, ctx: ResolveContext): Promise<void> {
  if (agent.onUninstalled) {
    const mctx: MaterializeContext = { ...ctx, agentId: agent.id };
    ctx.logger.info(`-> ${agent.id}.onUninstalled`);
    await agent.onUninstalled(mctx);
  }
  const state = await readState(ctx.statePath);
  await writeState(ctx.statePath, unmarkAgentInstalled(state, agent.id));
}

// ---------- helpers ----------

export function orderedDomains(registry: PluginRegistry): RegisteredDomain[] {
  return [...registry.domains.values()].sort((a, b) => {
    const ap = Number.isFinite(a.plugin.priority) ? a.plugin.priority : Number.POSITIVE_INFINITY;
    const bp = Number.isFinite(b.plugin.priority) ? b.plugin.priority : Number.POSITIVE_INFINITY;
    return ap - bp;
  });
}

/**
 * Resolve the per-domain state slices an agent's `handles.<domain>.onInitialize`
 * needs. The map is keyed by domain name so third-party domains can hook in.
 */
export async function buildAgentDomainStates(
  config: AgnosConfig,
  ctx: ResolveContext,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};

  if (config.rules) {
    out["rules"] = await resolveRule(config.rules.source, ctx);
  } else {
    out["rules"] = undefined;
  }

  out["mcp"] = (config.mcp ?? []).map((m) => ({ ...m })) as ResolvedMcp[];

  const skillsDir = buildPaths(ctx.projectRoot).skillsDir;
  out["skills"] = (config.skills ?? []).map((s) => ({
    name: s.name,
    absolutePath: path.join(skillsDir, s.name),
  })) as ResolvedSkill[];

  return out;
}

export async function materializeAgent(
  agent: AgentPlugin,
  config: AgnosConfig,
  registry: PluginRegistry,
  ctx: ResolveContext,
): Promise<void> {
  const mctx: MaterializeContext = { ...ctx, agentId: agent.id };
  const state = await buildAgentDomainStates(config, ctx);
  ctx.logger.info(`-> ${agent.id}`);
  for (const dom of orderedDomains(registry)) {
    const handlers = handlersFor(agent, dom.plugin.name);
    const fn = handlers?.onInitialize as ((s: unknown, c: MaterializeContext) => Promise<void>) | undefined;
    if (!fn) continue;
    ctx.logger.info(`  ${dom.plugin.name}.onInitialize`);
    await fn(state[dom.plugin.name], mctx);
  }
}

interface AnyDomainHandlers {
  onInitialize?: (state: unknown, ctx: MaterializeContext) => Promise<void>;
  onCleanup?: (ctx: MaterializeContext) => Promise<void>;
}

function handlersFor(agent: AgentPlugin, domainName: string): AnyDomainHandlers | undefined {
  const handles = agent.handles as DomainEventHandlers | undefined;
  if (!handles) return undefined;
  return (handles as unknown as Record<string, AnyDomainHandlers | undefined>)[domainName];
}

async function initializeNewDomains(registry: PluginRegistry, ctx: ResolveContext): Promise<boolean> {
  let state = await readState(ctx.statePath);
  for (const dom of orderedDomains(registry)) {
    if (isDomainInitialized(state, dom.plugin.name)) continue;
    if (dom.plugin.onInitialize) {
      ctx.logger.info(`-> ${dom.plugin.name}.onInitialize`);
      try {
        await dom.plugin.onInitialize(ctx);
      } catch (err) {
        ctx.logger.error(`${dom.plugin.name}.onInitialize failed: ${(err as Error).message}`);
        return false;
      }
    }
    state = markDomainInitialized(state, dom.plugin.name);
    await writeState(ctx.statePath, state);
  }
  return true;
}

async function ensureAgentInstalled(agent: AgentPlugin, ctx: ResolveContext): Promise<boolean> {
  const state = await readState(ctx.statePath);
  if (isAgentInstalled(state, agent.id)) return true;
  if (agent.onInstalled) {
    ctx.logger.info(`-> ${agent.id}.onInstalled`);
    try {
      await agent.onInstalled(ctx);
    } catch (err) {
      ctx.logger.error(`${agent.id}.onInstalled failed: ${(err as Error).message}`);
      return false;
    }
  }
  await writeState(ctx.statePath, markAgentInstalled(state, agent.id));
  return true;
}

async function ensurePrivileges(
  ctx: ResolveContext,
  config: AgnosConfig,
  agents: AgentPlugin[],
  opts: InstallOptions,
): Promise<ResolveContext | null> {
  const needsFile = computeFileSymlinkNeed(config, agents);
  const needsDir = computeDirSymlinkNeed(config, agents);
  const decision = await ensureSymlinkPrivileges(
    ctx,
    { fileSymlinks: needsFile, dirSymlinks: needsDir },
    { interactive: opts.interactive ?? true, autoCopy: opts.copyOnNoSymlink ?? false },
  );
  if (!decision.proceed) return null;
  return decision.copyFallback ? rebuildContextWithCopyFallback(ctx) : ctx;
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
 * Orphan cleanup. Acts directly on the filesystem; does not dispatch events.
 */
export async function reconcile(
  config: AgnosConfig,
  agents: AgentPlugin[],
  ctx: ResolveContext,
): Promise<void> {
  const paths = buildPaths(ctx.projectRoot);
  const declaredSkills = new Set((config.skills ?? []).map((s) => s.name));

  await pruneSkillsDir(paths.skillsDir, declaredSkills, ctx);
  for (const agent of agents) {
    const dir = agentSkillDir(agent.id, ctx.projectRoot);
    if (!dir) continue;
    await pruneSkillsDir(dir, declaredSkills, ctx, /* skipMissingDir */ true);
  }
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

export { resolveAgentByRef, refToId };
export type { RegisteredAgent };
