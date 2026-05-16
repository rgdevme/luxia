import fs from "node:fs/promises";
import path from "node:path";
import { checkbox } from "@inquirer/prompts";
import { buildPaths, ensureDir } from "../paths.js";
import { configExists, readConfigOrDefault, writeConfig, DEFAULT_CONFIG } from "../config.js";
import { runRules } from "./rules.js";
import { loadPlugins, refToId } from "../plugin-loader.js";
import { buildResolveContext } from "../context.js";
import { reinstate } from "../orchestrator.js";
import type { AgentRef, Logger } from "../types/public.js";

const STARTER_RULES = `# AGENTS.md

> Project guidance for AI coding agents (Claude Code, Codex, Cursor, …).
> This file is the canonical rules document for the agnos-managed project.

## Overview

_Describe what this project does, who it's for, and any high-level conventions._

## Conventions

_List code style, testing, or documentation conventions agents should follow._

## Don'ts

_List specific things agents should not do._
`;

export interface InitOptions {
  cwd: string;
  yes: boolean;
  copyOnNoSymlink: boolean;
  logger: Logger;
}

export async function runInit(opts: InitOptions): Promise<void> {
  const paths = buildPaths(opts.cwd);
  const existed = await configExists(paths.configPath);

  if (!existed) {
    const initial = structuredClone(DEFAULT_CONFIG);
    initial.agents = [];
    await writeConfig(paths.configPath, initial);
    opts.logger.success(`created ${path.relative(opts.cwd, paths.configPath)}`);
  } else {
    opts.logger.info(`${path.relative(opts.cwd, paths.configPath)} already exists`);
  }

  await ensureDir(paths.agnosRoot);
  await ensureDir(paths.cacheDir);
  await ensureGitIgnore(opts.cwd, opts.logger);

  // 1) Rules-source path (interactive unless -y).
  await runRules({ cwd: opts.cwd, yes: opts.yes, logger: opts.logger });

  // 2) Pick agents (inline; do NOT call runAgents — it does its own reinstate).
  await promptAndPersistAgents(opts);

  // 3) Single materialization pass: domain.onInitialize for each domain not yet
  //    initialized, then per active agent: onInstalled (state-gated) + per-domain
  //    onInitialize in priority order. Reconciles orphans at the end.
  const config = await readConfigOrDefault(paths.configPath);
  const ctx = await buildResolveContext({ projectRoot: opts.cwd, logger: opts.logger });
  const registry = await loadPlugins({ projectRoot: opts.cwd, logger: opts.logger });
  await reinstate(config, registry, ctx, {
    copyOnNoSymlink: opts.copyOnNoSymlink,
    interactive: !opts.yes,
  });
}

async function promptAndPersistAgents(opts: InitOptions): Promise<void> {
  const paths = buildPaths(opts.cwd);
  const config = await readConfigOrDefault(paths.configPath);

  if (opts.yes) {
    if (!config.agents || config.agents.length === 0) {
      opts.logger.info("no agents enabled (run `agnos agents` to pick later)");
    }
    return;
  }

  const registry = await loadPlugins({ projectRoot: opts.cwd, logger: opts.logger });
  const available = [...registry.agents.values()];
  if (available.length === 0) {
    opts.logger.warn(
      "no agent plugins installed. Install one with `agnos agent add <id>` or `pnpm add @agnos/agent-claude-code`.",
    );
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

  const newRefs: AgentRef[] = selectedIds.map((id) => id);
  config.agents = newRefs;
  await writeConfig(paths.configPath, config);
  opts.logger.success(`agnos.json updated (${selectedIds.length} agent${selectedIds.length === 1 ? "" : "s"} enabled)`);
}

async function ensureGitIgnore(cwd: string, logger: Logger): Promise<void> {
  const giPath = path.join(cwd, ".gitignore");
  let current = "";
  try {
    current = await fs.readFile(giPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const requiredLines = [".agnos/cache/", ".agnos/state.json"];
  const existingLines = current.split(/\r?\n/).map((l) => l.trim());
  const missing = requiredLines.filter((line) => !existingLines.includes(line));
  if (missing.length === 0) return;
  const prefix = current.length === 0 || current.endsWith("\n") ? current : current + "\n";
  const updated = prefix + missing.map((l) => `${l}\n`).join("");
  await fs.writeFile(giPath, updated, "utf8");
  logger.info(`updated .gitignore (+ ${missing.join(", ")})`);
}

export async function ensureStarterRules(rulesPath: string): Promise<{ created: boolean }> {
  try {
    await fs.access(rulesPath);
    return { created: false };
  } catch {
    await fs.mkdir(path.dirname(rulesPath), { recursive: true });
    await fs.writeFile(rulesPath, STARTER_RULES, "utf8");
    return { created: true };
  }
}
