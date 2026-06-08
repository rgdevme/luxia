import fs from "node:fs/promises";
import path from "node:path";
import { select } from "@inquirer/prompts";
import type {
  AgentPlugin,
  AgnosConfig,
  DomainEventHandlers,
  Logger,
  MaterializeContext,
  McpDeclaration,
  ResolveContext,
  ResolvedMcp,
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
import { readConfigOrDefault, writeConfig } from "./config.js";
import { mcpDeclarationSchema } from "./schema.js";
import { ensureSymlinkPrivileges, rebuildContextWithCopyFallback } from "./context.js";
import {
  hasImported,
  isAgentInstalled,
  isDomainInitialized,
  markAgentInstalled,
  markDomainInitialized,
  markImported,
  readState,
  unmarkAgentInstalled,
  writeState,
} from "./state.js";
import { activeAgents, dispatchSkillRemoved } from "./events.js";
import { indentedLogger } from "./logger.js";
import { runHook } from "./hooks.js";
import { prepareSkills } from "./skill-prepare.js";
import { resolveRules } from "./materialize-rules.js";

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
          `Disambiguate in agnos.json.agents by replacing the colliding id with the full package name.`,
      );
    }
    return { ok: false };
  }

  const agents = activeAgents(config, registry, ctx);

  const runCtx = await ensurePrivileges(ctx, config, agents, opts);
  if (!runCtx) return { ok: false };

  // 1) onInstalled (once per agent per local env). Silent if no top-level hook.
  for (const agent of agents) {
    if (!(await ensureAgentInstalled(agent, runCtx))) return { ok: false };
  }

  // 2) Skill pre-pass: fetch + hash-verify (or pin) + materialize every declared
  //    skill into the canonical dir BEFORE any agent hook runs. This is what
  //    makes a fresh clone reproducible and surfaces upstream drift loudly.
  try {
    await prepareSkills(config, runCtx);
  } catch (err) {
    runCtx.logger.error(`skill prepare failed: ${(err as Error).message}`);
    return { ok: false };
  }

  // 3) Domain-outer interleaved fan-out: each domain's onInitialize, then each
  //    agent's per-domain onInitialize in priority order.
  try {
    await initializeAgentsInterleaved(agents, config, registry, runCtx, {
      interactive: opts.interactive ?? true,
    });
  } catch (err) {
    runCtx.logger.error(`initialize failed: ${(err as Error).message}`);
    return { ok: false };
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
  opts: { interactive?: boolean } = {},
): Promise<void> {
  if (!(await ensureAgentInstalled(agent, ctx))) {
    throw new Error(`onInstalled failed for ${agent.id}`);
  }
  await materializeAgent(agent, config, registry, ctx, opts);
}

/**
 * Run per-domain onCleanup for an agent (in reverse priority order). Does
 * NOT modify agnos.json or state.json. For each domain, fires
 * `onAgentDeactivate` first (so the domain can decide whether to keep shared
 * artifacts based on the remaining active agents), then the agent's own
 * `handles.<domain>.onCleanup`.
 */
export async function cleanupAgent(
  agent: AgentPlugin,
  registry: PluginRegistry,
  ctx: ResolveContext,
  opts: { remainingAgents?: readonly AgentPlugin[] } = {},
): Promise<void> {
  const mctx = buildMaterializeCtx(ctx, agent.id, "  ");
  const verb = ctx.dryRun ? "would: " : "-> ";
  const remaining = opts.remainingAgents ?? [];
  for (const dom of orderedDomains(registry).reverse()) {
    if (dom.plugin.onAgentDeactivate) {
      ctx.logger.info(`${verb}${dom.plugin.name}.onAgentDeactivate[${agent.id}]`);
      if (!ctx.dryRun) {
        await runHook(`${dom.plugin.name}.onAgentDeactivate[${agent.id}]`, () =>
          dom.plugin.onAgentDeactivate!(agent, remaining, mctx),
        );
      }
    }
    const handlers = handlersFor(agent, dom.plugin.name);
    const fn = handlers?.onCleanup;
    if (!fn) continue;
    ctx.logger.info(`${verb}${agent.id}.${dom.plugin.name}.onCleanup`);
    if (ctx.dryRun) continue;
    await runHook(`${agent.id}.${dom.plugin.name}.onCleanup`, () => fn(mctx));
  }
}

/**
 * Mark an agent uninstalled in state.json and fire onUninstalled (top-level).
 * Caller is responsible for calling cleanupAgent first if the agent was active.
 */
export async function uninstallAgent(agent: AgentPlugin, ctx: ResolveContext): Promise<void> {
  const verb = ctx.dryRun ? "would: " : "-> ";
  if (agent.onUninstalled) {
    const mctx = buildMaterializeCtx(ctx, agent.id, "  ");
    ctx.logger.info(`${verb}${agent.id}.onUninstalled`);
    if (!ctx.dryRun) {
      await runHook(`${agent.id}.onUninstalled`, () => agent.onUninstalled!(mctx));
    }
  }
  if (ctx.dryRun) {
    ctx.logger.info(`would: unmark ${agent.id} in state.json`);
    return;
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

  out["rules"] = config.rules ? resolveRules(config.rules, ctx) : [];

  out["mcp"] = (config.mcp ?? []).map((m) => ({ ...m })) as ResolvedMcp[];

  const skillsDir = buildPaths(ctx.projectRoot, config).skillsDir;
  out["skills"] = Object.keys(config.skills?.sources ?? {}).map((name) => ({
    name,
    absolutePath: path.join(skillsDir, name),
  })) as ResolvedSkill[];

  return out;
}

/**
 * Domain-outer interleaved initialization. For each domain in priority order:
 *   1. Log the section header `-> <domain>.onInitialize`.
 *   2. Run the domain's own `onInitialize` once per project (state-gated).
 *   3. For each agent that handles the domain, fire its `onInitialize` with
 *      the per-domain state slice.
 *
 * Used by `reinstate` for the multi-agent case and by `materializeAgent` for
 * the single-agent case (which is just a one-element list).
 */
export async function initializeAgentsInterleaved(
  agents: AgentPlugin[],
  config: AgnosConfig,
  registry: PluginRegistry,
  ctx: ResolveContext,
  opts: { interactive?: boolean } = {},
): Promise<void> {
  const interactive = opts.interactive ?? true;
  let state = await buildAgentDomainStates(config, ctx);
  let projectState = await readState(ctx.statePath);

  for (const dom of orderedDomains(registry)) {
    const verb = ctx.dryRun ? "would: " : "-> ";
    ctx.logger.info(`${verb}${dom.plugin.name}.onInitialize`);

    if (!isDomainInitialized(projectState, dom.plugin.name)) {
      if (dom.plugin.onInitialize && !ctx.dryRun) {
        await runHook(`${dom.plugin.name}.onInitialize`, () => dom.plugin.onInitialize!(ctx));
      }
      if (!ctx.dryRun) {
        projectState = markDomainInitialized(projectState, dom.plugin.name);
        await writeState(ctx.statePath, projectState);
      }
    }

    // One-time reverse-import pass: lets agents contribute existing per-agent
    // config (e.g. .mcp.json) back into agnos.json before forward materialization.
    const importChanged = await runDomainImportPass(agents, dom, config, ctx, { interactive });
    if (importChanged) {
      state = await buildAgentDomainStates(config, ctx);
      projectState = await readState(ctx.statePath);
    }

    for (const agent of agents) {
      const handlers = handlersFor(agent, dom.plugin.name);
      const fn = handlers?.onInitialize as
        | ((s: unknown, c: MaterializeContext) => Promise<void>)
        | undefined;
      const hasActivate = !!dom.plugin.onAgentActivate;
      if (!fn && !hasActivate) continue;
      const mctx = buildMaterializeCtx(ctx, agent.id, "    ");
      ctx.logger.info(`  ${verb}${agent.id}`);
      if (hasActivate) {
        ctx.logger.info(`    ${dom.plugin.name}.onAgentActivate`);
        if (!ctx.dryRun) {
          await runHook(`${dom.plugin.name}.onAgentActivate[${agent.id}]`, () =>
            dom.plugin.onAgentActivate!(agent, agents, mctx),
          );
        }
      }
      if (fn) {
        ctx.logger.info(`    ${dom.plugin.name}.onInitialize`);
        if (!ctx.dryRun) {
          await runHook(`${agent.id}.${dom.plugin.name}.onInitialize`, () =>
            fn(state[dom.plugin.name], mctx),
          );
        }
      }
    }
  }
}

/**
 * Per-domain one-time import pass. For each agent that has not yet imported
 * this domain (state.json-gated), call `handles.<domain>.onImport`, validate
 * the returned declarations, resolve conflicts (interactively when allowed),
 * and merge into agnos.json. Currently only `mcp` participates; other domains
 * are ignored even if they define onImport.
 *
 * Returns true if agnos.json or state.json was modified.
 */
async function runDomainImportPass(
  agents: AgentPlugin[],
  dom: RegisteredDomain,
  config: AgnosConfig,
  ctx: ResolveContext,
  opts: { interactive: boolean },
): Promise<boolean> {
  if (ctx.dryRun) return false;
  if (dom.plugin.name !== "mcp") return false;

  let projectState = await readState(ctx.statePath);
  let mutated = false;

  type Owner = { kind: "config" } | { kind: "agent"; id: string };
  const owners = new Map<string, Owner>();
  for (const m of config.mcp ?? []) owners.set(m.name, { kind: "config" });

  for (const agent of agents) {
    if (hasImported(projectState, agent.id, dom.plugin.name)) continue;
    const handlers = handlersFor(agent, dom.plugin.name);
    const onImport = handlers?.onImport;
    if (!onImport) continue;

    const mctx = buildMaterializeCtx(ctx, agent.id, "    ");
    ctx.logger.info(`  -> ${agent.id}`);

    let raw: unknown[] = [];
    try {
      const result = await onImport(mctx);
      raw = Array.isArray(result) ? result : [];
    } catch (err) {
      mctx.logger.warn(`${dom.plugin.name}.onImport failed: ${(err as Error).message}`);
      raw = [];
    }

    let imported = 0;
    let kept = 0;
    for (const candidate of raw) {
      const parsed = mcpDeclarationSchema.safeParse(candidate);
      if (!parsed.success) {
        mctx.logger.warn(`skipping invalid imported entry: ${parsed.error.message}`);
        continue;
      }
      const decl = parsed.data as McpDeclaration;
      const existingOwner = owners.get(decl.name);
      if (!existingOwner) {
        config.mcp = [...(config.mcp ?? []), decl];
        owners.set(decl.name, { kind: "agent", id: agent.id });
        imported++;
        mutated = true;
        continue;
      }
      const existing = (config.mcp ?? []).find((m) => m.name === decl.name);
      if (!existing) {
        // Shouldn't happen given owners map, but treat as additive.
        config.mcp = [...(config.mcp ?? []), decl];
        owners.set(decl.name, { kind: "agent", id: agent.id });
        imported++;
        mutated = true;
        continue;
      }
      const choice = await resolveMcpConflict({
        name: decl.name,
        existingOwner,
        existing,
        importedFrom: agent.id,
        imported: decl,
        interactive: opts.interactive,
        logger: mctx.logger,
      });
      if (choice === "replace") {
        config.mcp = (config.mcp ?? []).map((m) => (m.name === decl.name ? decl : m));
        owners.set(decl.name, { kind: "agent", id: agent.id });
        imported++;
        mutated = true;
      } else {
        kept++;
      }
    }

    const parts = [`imported ${imported}`];
    if (kept > 0) parts.push(`kept ${kept} existing`);
    mctx.logger.info(`${dom.plugin.name}.onImport (${parts.join(", ")})`);

    projectState = markImported(projectState, agent.id, dom.plugin.name);
    await writeState(ctx.statePath, projectState);
  }

  if (mutated) {
    await writeConfig(buildPaths(ctx.projectRoot).configPath, config);
  }
  return mutated;
}

interface OwnerRef {
  kind: "config" | "agent";
  id?: string;
}

async function resolveMcpConflict(opts: {
  name: string;
  existingOwner: OwnerRef;
  existing: McpDeclaration;
  importedFrom: string;
  imported: McpDeclaration;
  interactive: boolean;
  logger: Logger;
}): Promise<"keep" | "replace"> {
  const existingLabel =
    opts.existingOwner.kind === "config"
      ? "already in agnos.json"
      : `already imported from "${opts.existingOwner.id}"`;

  if (!opts.interactive) {
    opts.logger.info(
      `conflict: keeping existing "${opts.name}" (${existingLabel}); imported from "${opts.importedFrom}" skipped`,
    );
    return "keep";
  }

  const choice = await select<"keep" | "replace">({
    message:
      `MCP server "${opts.name}" conflict (${existingLabel}; new from "${opts.importedFrom}"):\n` +
      `  existing: ${summarizeMcp(opts.existing)}\n` +
      `  imported: ${summarizeMcp(opts.imported)}`,
    choices: [
      { name: "Keep existing", value: "keep" },
      { name: `Replace with imported (from ${opts.importedFrom})`, value: "replace" },
    ],
    default: "keep",
  });
  return choice;
}

function summarizeMcp(m: McpDeclaration): string {
  const parts: string[] = [];
  if (m.transport && m.transport !== "stdio") {
    parts.push(`${m.transport} ${m.command ?? ""}`.trim());
  } else {
    const args = m.args?.length ? " " + m.args.join(" ") : "";
    parts.push(`${m.command ?? ""}${args}`.trim() || "(no command)");
  }
  if (m.env && Object.keys(m.env).length) parts.push(`env: ${Object.keys(m.env).join(",")}`);
  return parts.join(" | ");
}

/**
 * Single-agent activation: delegates to the interleaved helper with a
 * one-element list so the log layout matches multi-agent flows.
 */
export async function materializeAgent(
  agent: AgentPlugin,
  config: AgnosConfig,
  registry: PluginRegistry,
  ctx: ResolveContext,
  opts: { interactive?: boolean } = {},
): Promise<void> {
  await initializeAgentsInterleaved([agent], config, registry, ctx, opts);
}

interface AnyDomainHandlers {
  onInitialize?: (state: unknown, ctx: MaterializeContext) => Promise<void>;
  onImport?: (ctx: MaterializeContext) => Promise<unknown[]>;
  onCleanup?: (ctx: MaterializeContext) => Promise<void>;
}

function handlersFor(agent: AgentPlugin, domainName: string): AnyDomainHandlers | undefined {
  const handles = agent.handles as DomainEventHandlers | undefined;
  if (!handles) return undefined;
  return (handles as unknown as Record<string, AnyDomainHandlers | undefined>)[domainName];
}

function buildMaterializeCtx(
  ctx: ResolveContext,
  agentId: string,
  indent: string,
): MaterializeContext {
  return { ...ctx, agentId, indent, logger: indentedLogger(ctx.logger, indent) };
}

async function ensureAgentInstalled(agent: AgentPlugin, ctx: ResolveContext): Promise<boolean> {
  const state = await readState(ctx.statePath);
  if (isAgentInstalled(state, agent.id)) return true;
  if (agent.onInstalled) {
    const verb = ctx.dryRun ? "would: " : "-> ";
    ctx.logger.info(`${verb}${agent.id}.onInstalled`);
    if (!ctx.dryRun) {
      try {
        await runHook(`${agent.id}.onInstalled`, () => agent.onInstalled!(ctx));
      } catch (err) {
        ctx.logger.error((err as Error).message);
        return false;
      }
    }
  }
  if (!ctx.dryRun) {
    await writeState(ctx.statePath, markAgentInstalled(state, agent.id));
  }
  return true;
}

async function ensurePrivileges(
  ctx: ResolveContext,
  config: AgnosConfig,
  agents: AgentPlugin[],
  opts: InstallOptions,
): Promise<ResolveContext | null> {
  const needsFile = computeFileSymlinkNeed(config, agents, ctx.projectRoot);
  const needsDir = computeDirSymlinkNeed(config, agents);
  const decision = await ensureSymlinkPrivileges(
    ctx,
    { fileSymlinks: needsFile, dirSymlinks: needsDir },
    { interactive: opts.interactive ?? true, autoCopy: opts.copyOnNoSymlink ?? false },
  );
  if (!decision.proceed) return null;
  return decision.copyFallback ? rebuildContextWithCopyFallback(ctx) : ctx;
}

export async function resolveSkill(name: string, ctx: ResolveContext): Promise<ResolvedSkill> {
  const config = await readConfigOrDefault(ctx.configPath);
  return {
    name,
    absolutePath: path.join(buildPaths(ctx.projectRoot, config).skillsDir, name),
  };
}

/**
 * Orphan cleanup. Dispatches `handles.skills.onRemoved` to active agents before
 * deleting any orphans from `.agnos/skills/`, so per-agent artifacts (e.g.,
 * `.claude/skills/<name>`) are removed through the standard event path. Errors
 * inside an agent's removal handler are logged but don't block the canonical
 * delete (otherwise we'd get stuck).
 */
export async function reconcile(
  config: AgnosConfig,
  agents: AgentPlugin[],
  ctx: ResolveContext,
): Promise<void> {
  const paths = buildPaths(ctx.projectRoot, config);
  const declaredSkills = new Set(Object.keys(config.skills?.sources ?? {}));

  const orphans = await findOrphans(paths.skillsDir, declaredSkills);
  for (const name of orphans) {
    if (ctx.dryRun) {
      ctx.logger.info(`would: reconcile orphan skill ${name}`);
      continue;
    }
    // Notify active agents BEFORE the canonical delete so they can clean their
    // per-agent artifacts (junctions, copies) cleanly.
    try {
      await dispatchSkillRemoved(name, agents, config, ctx);
    } catch (err) {
      ctx.logger.warn(`reconcile: ${(err as Error).message}; continuing with filesystem cleanup`);
    }
    const full = path.join(paths.skillsDir, name);
    await fs.rm(full, { recursive: true, force: true });
    ctx.logger.info(`reconcile: removed orphan ${path.relative(ctx.projectRoot, full)}`);
  }

  await sweepRuleOrphans(config, agents, ctx);
}

const RULE_SWEEP_IGNORES = new Set(["node_modules", ".git", ".agnos", "dist"]);

/**
 * Best-effort, symlink-only pruning of stale agent rule mirrors left behind by
 * hand edits to `agnos.json` (e.g. a `dirs` entry removed without
 * `agnos rules remove`). For each active agent we walk its materialization root
 * for files named after the agent's rule filename that are symlinks resolving
 * under the canonical rules root but no longer wanted. Copy-mode mirrors are
 * plain files and intentionally out of scope here — remove those via
 * `agnos rules remove`.
 */
async function sweepRuleOrphans(
  config: AgnosConfig,
  agents: AgentPlugin[],
  ctx: ResolveContext,
): Promise<void> {
  if (!config.rules) return;
  const entries = resolveRules(config.rules, ctx);
  const canonRoot = path.resolve(ctx.projectRoot, config.rules.root ?? ".");
  for (const agent of agents) {
    const agentFilename = agent.paths?.rulesFilename;
    if (!agentFilename) continue;
    const agentRoot = path.resolve(ctx.projectRoot, agent.paths?.rulesRoot ?? ".");
    const desired = new Set(
      entries.map((r) => path.resolve(path.join(agentRoot, r.dir, agentFilename))),
    );
    for (const linkPath of await findRuleMirrorSymlinks(agentRoot, agentFilename)) {
      if (desired.has(path.resolve(linkPath))) continue;
      let real: string;
      try {
        real = await fs.realpath(linkPath);
      } catch {
        continue; // broken link we didn't author — leave it
      }
      const rel = path.relative(canonRoot, real);
      if (rel.startsWith("..") || path.isAbsolute(rel)) continue; // not pointing into our tree
      if (ctx.dryRun) {
        ctx.logger.info(`would: reconcile orphan ${path.relative(ctx.projectRoot, linkPath)}`);
        continue;
      }
      await ctx.linker.unlink(linkPath);
      ctx.logger.info(`reconcile: removed orphan ${path.relative(ctx.projectRoot, linkPath)}`);
    }
  }
}

async function findRuleMirrorSymlinks(root: string, filename: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let dirents;
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of dirents) {
      const full = path.join(dir, e.name);
      if (e.isSymbolicLink()) {
        if (e.name === filename) out.push(full);
        continue; // never follow symlinked dirs
      }
      if (e.isDirectory() && !RULE_SWEEP_IGNORES.has(e.name)) {
        await walk(full);
      }
    }
  }
  await walk(root);
  return out;
}

async function findOrphans(dir: string, declared: ReadonlySet<string>): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  return entries.filter((name) => !declared.has(name));
}

function computeFileSymlinkNeed(
  config: AgnosConfig,
  agents: AgentPlugin[],
  projectRoot: string,
): boolean {
  if (agents.length === 0 || !config.rules) return false;
  const { root = ".", filename = "AGENTS.md" } = config.rules;
  const canonRoot = path.resolve(projectRoot, root);
  for (const a of agents) {
    const agentFilename = a.paths?.rulesFilename;
    if (!agentFilename) {
      // Custom rules agent that owns its own materialization — assume it may
      // need file symlinks so we probe/prompt for the capability.
      if (a.handles?.rules) return true;
      continue;
    }
    // A mirror is a symlink whenever its path differs from the canonical, i.e.
    // the agent's filename or root differs. (The shared `dir` cancels out.)
    const agentRoot = path.resolve(projectRoot, a.paths?.rulesRoot ?? ".");
    if (agentFilename !== filename || agentRoot !== canonRoot) return true;
  }
  return false;
}

function computeDirSymlinkNeed(config: AgnosConfig, agents: AgentPlugin[]): boolean {
  if (!config.skills?.sources || Object.keys(config.skills.sources).length === 0) return false;
  // Any active agent that declares a skills dir will trigger a dir-level
  // symlink in the skills domain bootstrap. Custom `handles.skills` agents
  // own their own materialization and may also need dir symlinks; we treat
  // their presence as also requiring the capability.
  return agents.some((a) => Boolean(a.paths?.skillsDir) || Boolean(a.handles?.skills));
}

export { resolveAgentByRef, refToId };
export type { RegisteredAgent };
