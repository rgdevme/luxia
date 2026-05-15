import { checkbox } from "@inquirer/prompts";
import { spawn } from "node:child_process";
import { buildPaths } from "../paths.js";
import { readConfigOrDefault, writeConfig } from "../config.js";
import { loadPlugins, refToId, resolveAgentByRef } from "../plugin-loader.js";
import { buildResolveContext } from "../context.js";
import { cleanupAgent, install } from "../orchestrator.js";
import type { AgentRef, Logger } from "../types/public.js";

export interface AgentsOptions {
  cwd: string;
  copyOnNoSymlink?: boolean;
  logger: Logger;
  fromInit?: boolean;
}

export async function runAgents(opts: AgentsOptions): Promise<void> {
  const paths = buildPaths(opts.cwd);
  const config = await readConfigOrDefault(paths.configPath);
  const ctx = await buildResolveContext({ projectRoot: opts.cwd, logger: opts.logger });
  const registry = await loadPlugins({ projectRoot: opts.cwd, logger: opts.logger });

  const available = [...registry.agents.values()];
  if (available.length === 0) {
    opts.logger.warn(
      "no agent plugins installed. Install one with `agnos agent add <id>` or `pnpm add @agnos/agent-claude-code`.",
    );
    if (!opts.fromInit) return;
    // still mark init as complete; user can add later
    return;
  }

  const currentIds = new Set((config.agents ?? []).map(refToId));

  const selectedIds = await checkbox<string>({
    message: "Pick the agents to enable in this project:",
    choices: available.map((a) => ({
      name: `${a.plugin.displayName} (${a.plugin.id}) — ${a.packageName}`,
      value: a.plugin.id,
      checked: currentIds.has(a.plugin.id),
    })),
  });

  const removed = [...currentIds].filter((id) => !selectedIds.includes(id));
  const newRefs: AgentRef[] = selectedIds.map((id) => id);

  // Run cleanup for newly removed agents while their plugins are still installed.
  for (const id of removed) {
    const reg = registry.agents.get(id);
    if (!reg) continue;
    opts.logger.info(`cleaning up ${reg.plugin.displayName}`);
    await cleanupAgent(reg.plugin, ctx);
  }

  config.agents = newRefs;
  await writeConfig(paths.configPath, config);
  opts.logger.success(`agnos.json updated (${selectedIds.length} agent${selectedIds.length === 1 ? "" : "s"} enabled)`);

  if (selectedIds.length > 0) {
    await install(config, registry, ctx, { copyOnNoSymlink: opts.copyOnNoSymlink ?? false, interactive: true });
  }
}

export interface AgentAddOptions {
  cwd: string;
  target: string | undefined;
  noInstall: boolean;
  copyOnNoSymlink: boolean;
  logger: Logger;
}

export async function runAgentAdd(opts: AgentAddOptions): Promise<void> {
  if (!opts.target) throw new Error("usage: agnos agent add <id|package>");
  const target = opts.target;
  const pkgName = inferPackageName(target);

  opts.logger.info(`installing ${pkgName} ...`);
  await runPnpm(["add", pkgName], opts.cwd);

  // Load fresh registry; figure out the id (in case we installed by package name)
  const registry = await loadPlugins({ projectRoot: opts.cwd, logger: opts.logger });
  const byPkg = registry.agentsByPackage.get(pkgName);
  if (!byPkg) {
    opts.logger.warn(
      `installed ${pkgName} but no agnos agent manifest was detected. ` +
        `Make sure the package's package.json has { "agnos": { "type": "agent", "id": "..." } }.`,
    );
    return;
  }

  const paths = buildPaths(opts.cwd);
  const config = await readConfigOrDefault(paths.configPath);
  const ids = new Set((config.agents ?? []).map(refToId));
  if (!ids.has(byPkg.plugin.id)) {
    config.agents = [...(config.agents ?? []), byPkg.plugin.id];
    await writeConfig(paths.configPath, config);
    opts.logger.success(`enabled agent: ${byPkg.plugin.id}`);
  } else {
    opts.logger.info(`agent ${byPkg.plugin.id} was already enabled`);
  }

  if (!opts.noInstall) {
    const ctx = await buildResolveContext({ projectRoot: opts.cwd, logger: opts.logger });
    await install(config, registry, ctx, { copyOnNoSymlink: opts.copyOnNoSymlink, interactive: true });
  }
}

export interface AgentRemoveOptions {
  cwd: string;
  id: string | undefined;
  logger: Logger;
}

export async function runAgentRemove(opts: AgentRemoveOptions): Promise<void> {
  if (!opts.id) throw new Error("usage: agnos agent remove <id>");
  const paths = buildPaths(opts.cwd);
  const config = await readConfigOrDefault(paths.configPath);
  const ctx = await buildResolveContext({ projectRoot: opts.cwd, logger: opts.logger });
  const registry = await loadPlugins({ projectRoot: opts.cwd, logger: opts.logger });

  const reg = resolveAgentByRef(registry, opts.id);
  if (!reg) {
    opts.logger.error(
      `no installed plugin matches "${opts.id}". ` +
        `If the package was already uninstalled, reinstall it first, then re-run \`agnos agent remove\`.`,
    );
    return;
  }

  opts.logger.info(`running cleanup for ${reg.plugin.displayName} ...`);
  await cleanupAgent(reg.plugin, ctx);

  config.agents = (config.agents ?? []).filter((a) => refToId(a) !== reg.plugin.id && (typeof a === "string" ? true : a.package !== reg.packageName));
  await writeConfig(paths.configPath, config);

  opts.logger.info(`uninstalling ${reg.packageName} ...`);
  await runPnpm(["remove", reg.packageName], opts.cwd);
  opts.logger.success(`removed agent: ${reg.plugin.id}`);
}

function inferPackageName(target: string): string {
  if (target.startsWith("@") || target.includes("/")) return target;
  return `@agnos/agent-${target}`;
}

function runPnpm(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("pnpm", args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pnpm ${args.join(" ")} exited with code ${code}`));
    });
  });
}
