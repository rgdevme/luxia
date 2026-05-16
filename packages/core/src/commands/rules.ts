import fs from "node:fs/promises";
import path from "node:path";
import { input, select } from "@inquirer/prompts";
import { buildPaths } from "../paths.js";
import { readConfigOrDefault, writeConfig } from "../config.js";
import { ensureStarterRules } from "./init.js";
import { buildResolveContext } from "../context.js";
import { loadPlugins } from "../plugin-loader.js";
import { resolveRule } from "../orchestrator.js";
import { activeAgents, dispatchRulesAdded, dispatchRulesMoved } from "../events.js";
import type { Logger } from "../types/public.js";

export interface RulesOptions {
  cwd: string;
  path?: string | undefined;
  yes: boolean;
  dryRun?: boolean;
  logger: Logger;
}

export async function runRules(opts: RulesOptions): Promise<void> {
  const paths = buildPaths(opts.cwd);
  const config = await readConfigOrDefault(paths.configPath);
  const previousSource = config.rules?.source;
  const current = previousSource ?? "./AGENTS.md";

  let target = opts.path ?? current;
  if (!opts.path && !opts.yes) {
    target = await input({
      message: "Rules-source path (relative to project root):",
      default: current,
    });
  }
  target = normalizeRelPath(target);

  const oldAbs = path.resolve(opts.cwd, current);
  const newAbs = path.resolve(opts.cwd, target);
  const pathUnchanged = path.relative(oldAbs, newAbs) === "";

  if (pathUnchanged) {
    const { created } = await ensureStarterRules(newAbs);
    if (created) opts.logger.success(`created ${target}`);
    if (!config.rules) {
      // first-time set: persist + fire onAdded
      config.rules = { source: target };
      await writeConfig(paths.configPath, config);
      await dispatchRulesIfActive(config, "added", { from: undefined, to: target }, opts);
    }
    return;
  }

  const oldExists = await pathExists(oldAbs);
  const newExists = await pathExists(newAbs);

  if (oldExists && !newExists) {
    await fs.mkdir(path.dirname(newAbs), { recursive: true });
    await fs.rename(oldAbs, newAbs);
    opts.logger.success(`moved rules from ${current} → ${target}`);
  } else if (oldExists && newExists) {
    if (opts.yes) {
      opts.logger.warn(`rules exist at both ${current} and ${target}; keeping ${target} as-is`);
    } else {
      const choice = await select<"overwrite" | "keep" | "cancel">({
        message: `${target} already exists. What do you want to do with ${current}?`,
        choices: [
          { name: `Keep ${target}, leave ${current} untouched`, value: "keep" },
          { name: `Overwrite ${target} with ${current}, delete ${current}`, value: "overwrite" },
          { name: "Cancel", value: "cancel" },
        ],
      });
      if (choice === "cancel") {
        opts.logger.info("aborted");
        return;
      }
      if (choice === "overwrite") {
        await fs.rm(newAbs, { force: true });
        await fs.rename(oldAbs, newAbs);
        opts.logger.success(`replaced ${target} with content from ${current}`);
      } else {
        opts.logger.info(`kept ${target}; ${current} is now orphaned`);
      }
    }
  } else if (!oldExists && !newExists) {
    const { created } = await ensureStarterRules(newAbs);
    if (created) opts.logger.success(`created starter ${target}`);
  } else {
    opts.logger.info(`using existing ${target}`);
  }

  config.rules = { source: target };
  await writeConfig(paths.configPath, config);
  opts.logger.info(`agnos.json: rules.source = ${target}`);

  // Dispatch the right event: first-time set → onAdded; otherwise → onMoved.
  if (previousSource === undefined) {
    await dispatchRulesIfActive(config, "added", { from: undefined, to: target }, opts);
  } else if (previousSource !== target) {
    await dispatchRulesIfActive(config, "moved", { from: previousSource, to: target }, opts);
  }
}

async function dispatchRulesIfActive(
  config: { agents?: unknown[] } & Record<string, unknown>,
  event: "added" | "moved",
  args: { from: string | undefined; to: string },
  opts: RulesOptions,
): Promise<void> {
  if (!config.agents || (Array.isArray(config.agents) && config.agents.length === 0)) return;
  const ctx = await buildResolveContext({
    projectRoot: opts.cwd,
    logger: opts.logger,
    dryRun: opts.dryRun ?? false,
  });
  const registry = await loadPlugins({ projectRoot: opts.cwd, logger: opts.logger });
  const agnosCfg = config as unknown as import("../types/public.js").AgnosConfig;
  const agents = activeAgents(agnosCfg, registry, ctx);
  const toResolved = await resolveRule(args.to, ctx);
  if (event === "added") {
    await dispatchRulesAdded(toResolved, agents, agnosCfg, ctx);
    return;
  }
  if (args.from === undefined) return;
  const fromResolved = await resolveRule(args.from, ctx);
  await dispatchRulesMoved(fromResolved, toResolved, agents, agnosCfg, ctx);
}

function normalizeRelPath(p: string): string {
  const trimmed = p.replace(/\\/g, "/").trim();
  if (trimmed.startsWith("./") || trimmed.startsWith("/")) return trimmed;
  return `./${trimmed}`;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
