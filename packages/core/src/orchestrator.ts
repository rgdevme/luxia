import fs from "node:fs/promises";
import path from "node:path";
import type {
  AgentPlugin,
  AgnosConfig,
  DomainHandler,
  MaterializeContext,
  ResolveContext,
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

interface InstallOptions {
  copyOnNoSymlink?: boolean;
  interactive?: boolean;
}

export async function install(
  config: AgnosConfig,
  registry: PluginRegistry,
  ctx: ResolveContext,
  opts: InstallOptions = {},
): Promise<{ ok: boolean }> {
  if (registry.collisions.length > 0) {
    for (const c of registry.collisions) {
      ctx.logger.error(
        `${c.type} id "${c.id}" is declared by multiple packages: ${c.packages.join(", ")}. ` +
          `Disambiguate in agnos.json.agents via { id, package }.`,
      );
    }
    return { ok: false };
  }

  const agentEntries = (config.agents ?? []).map((ref) => {
    const reg = resolveAgentByRef(registry, ref);
    return { ref, id: refToId(ref), registered: reg };
  });

  const missing = agentEntries.filter((e) => !e.registered);
  for (const m of missing) {
    ctx.logger.warn(`agent "${m.id}" is declared but its plugin is not installed — skipping`);
  }
  const activeAgents = agentEntries.filter((e): e is typeof e & { registered: RegisteredAgent } => Boolean(e.registered));

  const needsFile = computeFileSymlinkNeed(config, activeAgents);
  const needsDir = computeDirSymlinkNeed(config, activeAgents);

  const decision = await ensureSymlinkPrivileges(
    ctx,
    { fileSymlinks: needsFile, dirSymlinks: needsDir },
    { interactive: opts.interactive ?? true, autoCopy: opts.copyOnNoSymlink ?? false },
  );
  if (!decision.proceed) return { ok: false };
  const runCtx = decision.copyFallback ? rebuildContextWithCopyFallback(ctx) : ctx;

  // 1. Resolve every domain once.
  const resolved: Record<string, unknown[]> = {};
  for (const [name, dom] of registry.domains) {
    const decls = (config as Record<string, unknown>)[name];
    if (!Array.isArray(decls)) {
      if (decls === undefined) continue;
      // Special case: single-declaration domains (e.g., rules) live under one key.
      try {
        const item = await dom.plugin.resolve(decls, runCtx);
        resolved[name] = [item];
      } catch (err) {
        runCtx.logger.error(`domain ${name} failed to resolve: ${(err as Error).message}`);
        return { ok: false };
      }
      continue;
    }
    resolved[name] = [];
    for (const decl of decls) {
      try {
        const item = await dom.plugin.resolve(decl, runCtx);
        resolved[name]!.push(item);
      } catch (err) {
        runCtx.logger.error(`domain ${name} failed to resolve: ${(err as Error).message}`);
        return { ok: false };
      }
    }
  }

  // 2. For each declared agent, fan out to supported domains.
  for (const entry of activeAgents) {
    const agent = entry.registered.plugin;
    const materializeCtx: MaterializeContext = { ...runCtx, agentId: agent.id };
    runCtx.logger.info(`-> ${agent.displayName}`);
    for (const [domainName, handler] of Object.entries(agent.supports)) {
      if (!handler) continue;
      const items = resolved[domainName] ?? [];
      try {
        await (handler as DomainHandler<unknown>)(items, materializeCtx);
      } catch (err) {
        runCtx.logger.error(`${agent.id}.${domainName} failed: ${(err as Error).message}`);
        return { ok: false };
      }
    }
  }

  // 3. Prune orphaned skills inside .agnos/skills/.
  await pruneSkillOrphans(config, runCtx);

  runCtx.logger.success("install complete");
  return { ok: true };
}

function computeFileSymlinkNeed(
  config: AgnosConfig,
  agents: { id: string }[],
): boolean {
  if (agents.length === 0) return false;
  const rulesSource = config.rules?.source ?? "./AGENTS.md";
  const isDefault = normalize(rulesSource) === "./AGENTS.md";
  for (const a of agents) {
    if (a.id === "claude-code") return true;
    if (a.id === "codex" && !isDefault) return true;
  }
  return false;
}

function computeDirSymlinkNeed(
  config: AgnosConfig,
  agents: { id: string }[],
): boolean {
  if (!config.skills?.length) return false;
  return agents.some((a) => a.id === "claude-code");
}

function normalize(p: string): string {
  const trimmed = p.replace(/\\/g, "/");
  return trimmed.startsWith("./") ? trimmed : `./${trimmed}`;
}

async function pruneSkillOrphans(config: AgnosConfig, ctx: ResolveContext): Promise<void> {
  const paths = buildPaths(ctx.projectRoot);
  const declared = new Set((config.skills ?? []).map((s) => s.name));
  let entries: string[] = [];
  try {
    entries = await fs.readdir(paths.skillsDir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (!declared.has(name)) {
      const full = path.join(paths.skillsDir, name);
      await fs.rm(full, { recursive: true, force: true });
      ctx.logger.info(`pruned orphan skill: ${name}`);
    }
  }
}

export async function cleanupAgent(
  agent: AgentPlugin,
  ctx: ResolveContext,
): Promise<void> {
  const materializeCtx: MaterializeContext = { ...ctx, agentId: agent.id };
  await agent.cleanup(materializeCtx);
}

// Utility shared across commands: walk agent skill dirs and prune missing items
export async function pruneAgentSkillDir(
  dir: string,
  keep: ReadonlySet<string>,
): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const removed: string[] = [];
  for (const name of entries) {
    if (keep.has(name)) continue;
    const full = path.join(dir, name);
    await fs.rm(full, { recursive: true, force: true });
    removed.push(name);
  }
  return removed;
}

export type { ResolvedSkill };
