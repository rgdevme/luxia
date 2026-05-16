import fs from "node:fs/promises";
import path from "node:path";
import { buildPaths, ensureDir } from "../paths.js";
import { configExists, readConfigOrDefault, writeConfig, DEFAULT_CONFIG } from "../config.js";
import { runRules } from "./rules.js";
import { runAgents } from "./agents.js";
import { loadPlugins } from "../plugin-loader.js";
import { buildResolveContext } from "../context.js";
import { reinstate } from "../orchestrator.js";
import type { Logger } from "../types/public.js";

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

  // 1) rules
  await runRules({ cwd: opts.cwd, yes: opts.yes, logger: opts.logger });

  // 2) agents — interactive (or default-empty in -y).
  if (opts.yes) {
    const config = await readConfigOrDefault(paths.configPath);
    if (!config.agents || config.agents.length === 0) {
      opts.logger.info("no agents enabled (run `agnos agents` to pick later)");
    }
  } else {
    await runAgents({ cwd: opts.cwd, copyOnNoSymlink: opts.copyOnNoSymlink, logger: opts.logger, fromInit: true });
  }

  // 3) Drive the orchestrator: onInitialize for newly-detected domains, then
  //    onInstalled / onActivated / onReplay for active agents. Reconcile pass.
  const config = await readConfigOrDefault(paths.configPath);
  const ctx = await buildResolveContext({ projectRoot: opts.cwd, logger: opts.logger });
  const registry = await loadPlugins({ projectRoot: opts.cwd, logger: opts.logger });
  await reinstate(config, registry, ctx, {
    copyOnNoSymlink: opts.copyOnNoSymlink,
    interactive: !opts.yes,
  });
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
