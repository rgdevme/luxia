import { checkbox } from "@inquirer/prompts";
import { spawn } from "node:child_process";
import { buildPaths } from "../paths.js";
import { readConfigOrDefault, writeConfig } from "../config.js";
import { loadPlugins, refToId, resolveAgentByRef } from "../plugin-loader.js";
import { buildResolveContext } from "../context.js";
import {
  activateAgent,
  cleanupAgent,
  reconcile as reconcileOrphans,
  uninstallAgent,
} from "../orchestrator.js";
import type { AgentPlugin, AgentRef, Logger } from "../types/public.js";

export interface AgentsOptions {
  cwd: string;
  copyOnNoSymlink?: boolean;
  dryRun?: boolean;
  logger: Logger;
}

export async function runAgents(opts: AgentsOptions): Promise<void> {
  const paths = buildPaths(opts.cwd);
  const config = await readConfigOrDefault(paths.configPath);
  const ctx = await buildResolveContext({
    projectRoot: opts.cwd,
    logger: opts.logger,
    dryRun: opts.dryRun ?? false,
  });
  const registry = await loadPlugins({ projectRoot: opts.cwd, logger: opts.logger });

  const available = [...registry.agents.values()];
  if (available.length === 0) {
    opts.logger.warn(
      "no agent plugins installed. Install one with `agnos agent add <id>` or `pnpm add @luxia/agent-claude-code`.",
    );
    return;
  }

  const currentIds = new Set((config.agents ?? []).map((ref) => refToId(registry, ref)));
  const selectedIds = await checkbox<string>({
    message: "Pick the agents to enable in this project:",
    choices: available.map((a) => ({
      name: `${a.plugin.displayName} (${a.plugin.id}) — ${a.packageName}`,
      value: a.plugin.id,
      checked: currentIds.has(a.plugin.id),
    })),
  });

  const removed = [...currentIds].filter((id) => !selectedIds.includes(id));
  const added = selectedIds.filter((id) => !currentIds.has(id));

  // 1) Deactivate removed agents (per-domain cleanup) while their plugins are loadable.
  for (const id of removed) {
    const reg = registry.agents.get(id);
    if (!reg) continue;
    await cleanupAgent(reg.plugin, registry, ctx);
  }

  // 2) Persist new selection.
  const newRefs: AgentRef[] = selectedIds.map((id) => id);
  config.agents = newRefs;
  if (ctx.dryRun) {
    opts.logger.info(
      `would: write agnos.json (${selectedIds.length} agent${selectedIds.length === 1 ? "" : "s"} enabled)`,
    );
  } else {
    await writeConfig(paths.configPath, config);
    opts.logger.success(
      `agnos.json updated (${selectedIds.length} agent${selectedIds.length === 1 ? "" : "s"} enabled)`,
    );
  }

  // 3) Activate newly-added agents (per-domain onInitialize).
  for (const id of added) {
    const reg = registry.agents.get(id);
    if (!reg) continue;
    await activateAgent(reg.plugin, config, registry, ctx);
  }

  // 4) Reconcile orphans against the current active set.
  const activeAgents = newRefs
    .map((ref) => resolveAgentByRef(registry, ref)?.plugin)
    .filter((p): p is AgentPlugin => Boolean(p));
  await reconcileOrphans(config, activeAgents, ctx);
}

export interface AgentAddOptions {
  cwd: string;
  target: string | undefined;
  noInstall: boolean;
  noActivate: boolean;
  copyOnNoSymlink: boolean;
  dryRun?: boolean;
  logger: Logger;
}

export async function runAgentAdd(opts: AgentAddOptions): Promise<void> {
  if (!opts.target) throw new Error("usage: agnos agent add <id|package>");
  const target = opts.target;
  const pkgName = inferPackageName(target);

  if (opts.dryRun) {
    opts.logger.info(`would: pnpm add ${pkgName}`);
    if (opts.noActivate) {
      opts.logger.info(`would: leave new agent inactive (--no-activate)`);
      return;
    }
    opts.logger.info(`would: activate ${pkgName} (add to agnos.json.agents + run lifecycle)`);
    return;
  }

  opts.logger.info(`installing ${pkgName} ...`);
  await runPnpm(["add", pkgName], opts.cwd);

  const registry = await loadPlugins({ projectRoot: opts.cwd, logger: opts.logger });
  const byPkg = registry.agentsByPackage.get(pkgName);
  if (!byPkg) {
    opts.logger.warn(
      `installed ${pkgName} but no agnos agent manifest was detected. ` +
        `Make sure the package's package.json has { "agnos": { "type": "agent", "id": "..." } }.`,
    );
    return;
  }

  if (opts.noActivate) {
    opts.logger.info(`installed but not activated. Run \`agnos agents\` to activate later.`);
    return;
  }

  const paths = buildPaths(opts.cwd);
  const config = await readConfigOrDefault(paths.configPath);
  const ids = new Set((config.agents ?? []).map((ref) => refToId(registry, ref)));
  if (!ids.has(byPkg.plugin.id)) {
    config.agents = [...(config.agents ?? []), byPkg.plugin.id];
    await writeConfig(paths.configPath, config);
    opts.logger.success(`enabled agent: ${byPkg.plugin.id}`);
  } else {
    opts.logger.info(`agent ${byPkg.plugin.id} was already enabled`);
  }

  if (!opts.noInstall) {
    const ctx = await buildResolveContext({
      projectRoot: opts.cwd,
      logger: opts.logger,
      dryRun: opts.dryRun ?? false,
    });
    await activateAgent(byPkg.plugin, config, registry, ctx);
    // Reconcile against the post-add active set.
    const updatedActive = (config.agents ?? [])
      .map((ref) => resolveAgentByRef(registry, ref)?.plugin)
      .filter((p): p is AgentPlugin => Boolean(p));
    await reconcileOrphans(config, updatedActive, ctx);
  }
}

export interface AgentRemoveOptions {
  cwd: string;
  id: string | undefined;
  dryRun?: boolean;
  logger: Logger;
}

export async function runAgentRemove(opts: AgentRemoveOptions): Promise<void> {
  if (!opts.id) throw new Error("usage: agnos agent remove <id>");
  const paths = buildPaths(opts.cwd);
  const config = await readConfigOrDefault(paths.configPath);
  const ctx = await buildResolveContext({
    projectRoot: opts.cwd,
    logger: opts.logger,
    dryRun: opts.dryRun ?? false,
  });
  const registry = await loadPlugins({ projectRoot: opts.cwd, logger: opts.logger });

  const reg = resolveAgentByRef(registry, opts.id);
  if (!reg) {
    opts.logger.error(
      `no installed plugin matches "${opts.id}". ` +
        `If the package was already uninstalled, reinstall it first, then re-run \`agnos agent remove\`.`,
    );
    return;
  }

  // 1) If active: clean up per-domain artifacts.
  const isActive = (config.agents ?? []).some((a) => refToId(registry, a) === reg.plugin.id);
  if (isActive) {
    await cleanupAgent(reg.plugin, registry, ctx);
  }

  // 2) Remove from agnos.json.agents (matches by id OR package name).
  config.agents = (config.agents ?? []).filter((a) => refToId(registry, a) !== reg.plugin.id);
  if (ctx.dryRun) {
    opts.logger.info(`would: write agnos.json (drop ${reg.plugin.id})`);
  } else {
    await writeConfig(paths.configPath, config);
  }

  // 3) Top-level onUninstalled + mark uninstalled in state.
  await uninstallAgent(reg.plugin, ctx);

  // 4) pnpm remove the package.
  if (ctx.dryRun) {
    opts.logger.info(`would: pnpm remove ${reg.packageName}`);
    opts.logger.info(`would: removed agent: ${reg.plugin.id}`);
    return;
  }
  opts.logger.info(`uninstalling ${reg.packageName} ...`);
  await runPnpm(["remove", reg.packageName], opts.cwd);
  opts.logger.success(`removed agent: ${reg.plugin.id}`);
}

function inferPackageName(target: string): string {
  if (target.startsWith("@") || target.includes("/")) return target;
  return `@luxia/agent-${target}`;
}

function runPnpm(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("pnpm", args, {
      cwd,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pnpm ${args.join(" ")} exited with code ${code}`));
    });
  });
}
