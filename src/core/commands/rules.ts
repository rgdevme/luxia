import fs from "node:fs/promises";
import path from "node:path";
import { select } from "@inquirer/prompts";
import { buildPaths } from "../paths.js";
import { readConfigOrDefault, writeConfig } from "../config.js";
import { ensureStarterRules } from "./init.js";
import { buildResolveContext } from "../context.js";
import { loadPlugins, type PluginRegistry } from "../plugin-loader.js";
import { runDomainInitSteps } from "./init-steps.js";
import { activeAgents, dispatchRules } from "../events.js";
import { resolveRules, resolveRuleEntry, pruneRuleMirrors } from "../materialize-rules.js";
import type {
  AgentPlugin,
  AgnosConfig,
  Logger,
  MaterializeContext,
  ResolveContext,
  RulesDeclaration,
} from "../types/public.js";

export interface RulesOptions {
  cwd: string;
  /** Positional tokens after `agnos rules` (e.g. ["add", "./packages/a"]). */
  args: string[];
  yes: boolean;
  dryRun?: boolean;
  logger: Logger;
}

const DEFAULT_RULES: RulesDeclaration = { filename: "AGENTS.md", root: ".", dirs: [] };

export async function runRules(opts: RulesOptions): Promise<void> {
  const [first, second] = opts.args;
  if (first === "init") return runRulesInit(opts);
  if (first === "add") return runRulesAdd(second, opts);
  if (first === "remove" || first === "rm") return runRulesRemove(second, opts);
  if (first === undefined || first === "list" || first === "ls" || first === "show") {
    return runRulesShow(opts);
  }
  // Anything else is treated as a path → relocate the root rule file.
  return runRulesSetRoot(first, opts);
}

// ---------- shared loaders ----------

interface Loaded {
  ctx: ResolveContext;
  registry: PluginRegistry;
  config: AgnosConfig;
  rules: RulesDeclaration;
  agents: AgentPlugin[];
}

async function load(opts: RulesOptions): Promise<Loaded> {
  const ctx = await buildResolveContext({
    projectRoot: opts.cwd,
    logger: opts.logger,
    dryRun: opts.dryRun ?? false,
  });
  const registry = await loadPlugins({ projectRoot: opts.cwd, logger: opts.logger });
  const config = await readConfigOrDefault(buildPaths(opts.cwd).configPath);
  const rules = config.rules ?? structuredClone(DEFAULT_RULES);
  const agents = activeAgents(config, registry, ctx);
  return { ctx, registry, config, rules, agents };
}

function starterFor(registry: PluginRegistry): (() => string | Promise<string>) | undefined {
  const plugin = registry.domains.get("rules")?.plugin;
  return plugin?.getStarterContent ? () => plugin.getStarterContent!() : undefined;
}

function mctxFor(ctx: ResolveContext, agentId: string): MaterializeContext {
  return { ...ctx, agentId, indent: ctx.indent ?? "" };
}

function normalizeRelPath(p: string): string {
  const trimmed = p.replace(/\\/g, "/").trim();
  if (trimmed.startsWith("./") || trimmed.startsWith("../") || trimmed.startsWith("/")) {
    return trimmed;
  }
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

// ---------- subcommands ----------

async function runRulesInit(opts: RulesOptions): Promise<void> {
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
  await runDomainInitSteps(dom.plugin, ctx, { yes: opts.yes, dryRun: opts.dryRun ?? false });
}

async function runRulesShow(opts: RulesOptions): Promise<void> {
  const { ctx, rules, agents } = await load(opts);
  const log = opts.logger;
  log.info(`filename: ${rules.filename}`);
  log.info(`root:     ${rules.root}`);
  const entries = resolveRules(rules, ctx);
  log.info(`rule files (${entries.length}):`);
  for (const e of entries) log.info(`  ${e.relativeSource}`);
  if (agents.length > 0) log.info(`agents:   ${agents.map((a) => a.id).join(", ")}`);
}

async function runRulesAdd(dir: string | undefined, opts: RulesOptions): Promise<void> {
  if (!dir) {
    opts.logger.error("usage: agnos rules add <dir>");
    return;
  }
  const { ctx, registry, config, rules, agents } = await load(opts);
  const entry = resolveRuleEntry(rules, dir, ctx);
  const target = path.resolve(entry.absolutePath);
  const existing = resolveRules(rules, ctx).map((r) => path.resolve(r.absolutePath));
  if (existing.includes(target)) {
    opts.logger.info(`already managed: ${entry.relativeSource}`);
    return;
  }
  const normalized = dir.replace(/\\/g, "/").trim();
  if (opts.dryRun) {
    opts.logger.info(`would: add rules dir ${normalized} (${entry.relativeSource})`);
    return;
  }
  const { created } = await ensureStarterRules(entry.absolutePath, starterFor(registry));
  if (created) opts.logger.success(`created ${entry.relativeSource}`);
  rules.dirs = [...rules.dirs, normalized];
  config.rules = rules;
  await writeConfig(buildPaths(opts.cwd).configPath, config);
  opts.logger.info(`agnos.json: rules.dirs += ${normalized}`);
  if (agents.length > 0) await dispatchRules(agents, config, ctx);
}

async function runRulesRemove(dir: string | undefined, opts: RulesOptions): Promise<void> {
  if (!dir) {
    opts.logger.error("usage: agnos rules remove <dir>");
    return;
  }
  const { ctx, config, rules, agents } = await load(opts);
  const target = path.resolve(resolveRuleEntry(rules, dir, ctx).absolutePath);
  const idx = rules.dirs.findIndex(
    (d) => path.resolve(resolveRuleEntry(rules, d, ctx).absolutePath) === target,
  );
  if (idx === -1) {
    opts.logger.warn(`not a managed rules dir: ${dir}`);
    return;
  }
  const removed = rules.dirs[idx]!;
  const entry = resolveRuleEntry(rules, removed, ctx);

  // Prune each active agent's mirror for this dir (exact path — handles copies
  // and symlinks; the in-place guard protects the canonical file).
  for (const agent of agents) {
    const agentFilename = agent.paths?.rulesFilename;
    if (!agentFilename) continue;
    await pruneRuleMirrors(
      [entry],
      { agentRoot: agent.paths?.rulesRoot ?? ".", agentFilename },
      mctxFor(ctx, agent.id),
    );
  }

  if (opts.dryRun) {
    opts.logger.info(`would: rules.dirs -= ${removed}`);
    return;
  }
  rules.dirs = rules.dirs.filter((_, i) => i !== idx);
  config.rules = rules;
  await writeConfig(buildPaths(opts.cwd).configPath, config);
  opts.logger.info(`agnos.json: rules.dirs -= ${removed}`);
  opts.logger.info(`canonical ${entry.relativeSource} left in place`);
}

async function runRulesSetRoot(target: string, opts: RulesOptions): Promise<void> {
  const { ctx, registry, config, rules, agents } = await load(opts);
  const normalized = normalizeRelPath(target);
  const newRoot = path.dirname(normalized) || ".";
  const newFilename = path.basename(normalized);

  const oldAbs = path.resolve(opts.cwd, rules.root, rules.filename);
  const newAbs = path.resolve(opts.cwd, newRoot, newFilename);
  const unchanged = path.relative(oldAbs, newAbs) === "";

  const persist = async (): Promise<void> => {
    rules.root = newRoot;
    rules.filename = newFilename;
    config.rules = rules;
    if (rules.dirs.length > 0 && newRoot !== "." && !unchanged) {
      opts.logger.warn(
        `rules.dirs are resolved relative to root "${newRoot}"; nested canonical files were not moved`,
      );
    }
    if (opts.dryRun) {
      opts.logger.info(`would: agnos.json rules.root=${newRoot} filename=${newFilename}`);
      return;
    }
    await writeConfig(buildPaths(opts.cwd).configPath, config);
    opts.logger.info(`agnos.json: rules.root=${newRoot} filename=${newFilename}`);
    if (agents.length > 0) await dispatchRules(agents, config, ctx);
  };

  if (unchanged) {
    if (!opts.dryRun) {
      const { created } = await ensureStarterRules(newAbs, starterFor(registry));
      if (created) opts.logger.success(`created ${normalized}`);
    }
    await persist();
    return;
  }

  const oldExists = await pathExists(oldAbs);
  const newExists = await pathExists(newAbs);

  if (opts.dryRun) {
    opts.logger.info(`would: relocate root rule file → ${normalized}`);
    await persist();
    return;
  }

  if (oldExists && !newExists) {
    await fs.mkdir(path.dirname(newAbs), { recursive: true });
    await fs.rename(oldAbs, newAbs);
    opts.logger.success(`moved root rule file → ${normalized}`);
  } else if (oldExists && newExists) {
    const choice = opts.yes
      ? "keep"
      : await select<"overwrite" | "keep" | "cancel">({
          message: `${normalized} already exists. What about the current ${rules.filename}?`,
          choices: [
            { name: `Keep ${normalized}, leave the old file untouched`, value: "keep" },
            { name: `Overwrite ${normalized} with the old file`, value: "overwrite" },
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
      opts.logger.success(`replaced ${normalized} with the old file`);
    } else {
      opts.logger.info(`kept ${normalized}; old file left in place`);
    }
  } else {
    const { created } = await ensureStarterRules(newAbs, starterFor(registry));
    if (created) opts.logger.success(`created starter ${normalized}`);
  }

  await persist();
}
