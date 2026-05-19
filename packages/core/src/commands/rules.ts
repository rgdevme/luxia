import fs from "node:fs/promises";
import path from "node:path";
import { input, select } from "@inquirer/prompts";
import { buildPaths } from "../paths.js";
import { readConfigOrDefault, writeConfig } from "../config.js";
import { ensureStarterRules } from "./init.js";
import { buildResolveContext } from "../context.js";
import { loadPlugins } from "../plugin-loader.js";
import { resolveRule } from "../orchestrator.js";
import { runDomainInitSteps } from "./init-steps.js";
import { activeAgents, dispatchRulesAdded, dispatchRulesMoved } from "../events.js";
import type { AgnosConfig, Logger } from "../types/public.js";

export interface RulesOptions {
  cwd: string;
  path?: string | undefined;
  yes: boolean;
  dryRun?: boolean;
  logger: Logger;
}

export async function runRules(opts: RulesOptions): Promise<void> {
  if (opts.path === "init") {
    const ctx = await buildResolveContext({
      projectRoot: opts.cwd,
      logger: opts.logger,
      dryRun: opts.dryRun ?? false,
    });
    const registry = await loadPlugins({ projectRoot: opts.cwd, logger: opts.logger });
    const dom = registry.domains.get("rules");
    if (!dom) {
      throw new Error("no rules domain plugin installed. Run `pnpm add @luxia/domain-rules`.");
    }
    await runDomainInitSteps(dom.plugin, ctx, {
      yes: opts.yes,
      dryRun: opts.dryRun ?? false,
    });
    return;
  }
  const paths = buildPaths(opts.cwd);
  const config = await readConfigOrDefault(paths.configPath);
  const current = config.rules?.source ?? "./AGENTS.md";

  let target = opts.path ?? current;
  if (!opts.path && !opts.yes) {
    target = await input({
      message: "Rules-source path (relative to project root):",
      default: current,
    });
  }

  const registry = await loadPlugins({ projectRoot: opts.cwd, logger: opts.logger });
  const getStarterContent = registry.domains
    .get("rules")
    ?.plugin.getStarterContent?.bind(registry.domains.get("rules")?.plugin);

  await setRulesSource(target, {
    cwd: opts.cwd,
    yes: opts.yes,
    dryRun: opts.dryRun ?? false,
    logger: opts.logger,
    getStarterContent,
  });
}

export interface SetRulesSourceOptions {
  cwd: string;
  yes: boolean;
  dryRun: boolean;
  logger: Logger;
  /** Skip dispatching onAdded/onMoved to active agents. Used by `agnos init` where reinstate runs after. */
  noDispatch?: boolean;
  /** Starter content to seed the rules file with when none exists. */
  getStarterContent?: () => string | Promise<string>;
}

/**
 * Persist a rules-source path into `agnos.json`, handling file move/overwrite
 * scenarios and (optionally) dispatching onAdded/onMoved to active agents.
 * Pre-condition: `target` is the desired path; no further prompting happens
 * inside this function except the both-exist resolution prompt when `yes` is
 * false.
 */
export async function setRulesSource(target: string, opts: SetRulesSourceOptions): Promise<void> {
  const paths = buildPaths(opts.cwd);
  const config = await readConfigOrDefault(paths.configPath);
  const previousSource = config.rules?.source;
  const current = previousSource ?? "./AGENTS.md";
  const normalized = normalizeRelPath(target);

  const oldAbs = path.resolve(opts.cwd, current);
  const newAbs = path.resolve(opts.cwd, normalized);
  const pathUnchanged = path.relative(oldAbs, newAbs) === "";

  if (pathUnchanged) {
    const { created } = await ensureStarterRules(newAbs, opts.getStarterContent);
    if (created) opts.logger.success(`created ${normalized}`);
    if (!config.rules) {
      config.rules = { source: normalized };
      await writeConfig(paths.configPath, config);
      if (!opts.noDispatch) {
        await dispatchRulesIfActive(config, "added", { from: undefined, to: normalized }, opts);
      }
    }
    return;
  }

  const oldExists = await pathExists(oldAbs);
  const newExists = await pathExists(newAbs);

  if (oldExists && !newExists) {
    await fs.mkdir(path.dirname(newAbs), { recursive: true });
    await fs.rename(oldAbs, newAbs);
    opts.logger.success(`moved rules from ${current} → ${normalized}`);
  } else if (oldExists && newExists) {
    if (opts.yes) {
      opts.logger.warn(
        `rules exist at both ${current} and ${normalized}; keeping ${normalized} as-is`,
      );
    } else {
      const choice = await select<"overwrite" | "keep" | "cancel">({
        message: `${normalized} already exists. What do you want to do with ${current}?`,
        choices: [
          { name: `Keep ${normalized}, leave ${current} untouched`, value: "keep" },
          {
            name: `Overwrite ${normalized} with ${current}, delete ${current}`,
            value: "overwrite",
          },
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
        opts.logger.success(`replaced ${normalized} with content from ${current}`);
      } else {
        opts.logger.info(`kept ${normalized}; ${current} is now orphaned`);
      }
    }
  } else if (!oldExists && !newExists) {
    const { created } = await ensureStarterRules(newAbs, opts.getStarterContent);
    if (created) opts.logger.success(`created starter ${normalized}`);
  } else {
    opts.logger.info(`using existing ${normalized}`);
  }

  config.rules = { source: normalized };
  await writeConfig(paths.configPath, config);
  opts.logger.info(`agnos.json: rules.source = ${normalized}`);

  if (opts.noDispatch) return;
  if (previousSource === undefined) {
    await dispatchRulesIfActive(config, "added", { from: undefined, to: normalized }, opts);
  } else if (previousSource !== normalized) {
    await dispatchRulesIfActive(config, "moved", { from: previousSource, to: normalized }, opts);
  }
}

async function dispatchRulesIfActive(
  config: { agents?: unknown[] } & Record<string, unknown>,
  event: "added" | "moved",
  args: { from: string | undefined; to: string },
  opts: { cwd: string; logger: Logger; dryRun?: boolean },
): Promise<void> {
  if (!config.agents || (Array.isArray(config.agents) && config.agents.length === 0)) return;
  const ctx = await buildResolveContext({
    projectRoot: opts.cwd,
    logger: opts.logger,
    dryRun: opts.dryRun ?? false,
  });
  const registry = await loadPlugins({ projectRoot: opts.cwd, logger: opts.logger });
  const agnosCfg = config as unknown as AgnosConfig;
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
