import fs from "node:fs/promises";
import path from "node:path";
import { checkbox, confirm } from "@inquirer/prompts";
import { readDefaultRulesTemplate } from "@luxia/domain-rules/template";
import { buildPaths, ensureDir } from "../paths.js";
import { configExists, readConfigOrDefault, writeConfig, DEFAULT_CONFIG } from "../config.js";
import { runMigrate } from "./skill.js";
import { runAllDomainInitSteps } from "./init-steps.js";
import { loadPlugins, refToId } from "../plugin-loader.js";
import { buildResolveContext } from "../context.js";
import { reinstate } from "../orchestrator.js";
import type { AgentRef, Logger } from "../types/public.js";

const SKILLS_LOCK_FILE = "skills-lock.json";

export interface InitOptions {
  cwd: string;
  yes: boolean;
  copyOnNoSymlink: boolean;
  dryRun?: boolean;
  logger: Logger;
  /**
   * When set, only run init steps for these domain plugin ids. Also skips the
   * agents picker and the `skills.sh` lock migration prompt.
   */
  onlyIds?: readonly string[];
}

export async function runInit(opts: InitOptions): Promise<void> {
  const paths = buildPaths(opts.cwd);
  const existed = await configExists(paths.configPath);

  if (!existed) {
    const initial = structuredClone(DEFAULT_CONFIG);
    initial.agents = [];
    if (opts.dryRun) {
      opts.logger.info(`would: create ${path.relative(opts.cwd, paths.configPath)}`);
    } else {
      await writeConfig(paths.configPath, initial);
      opts.logger.success(`created ${path.relative(opts.cwd, paths.configPath)}`);
    }
  } else {
    opts.logger.info(`${path.relative(opts.cwd, paths.configPath)} already exists`);
  }

  if (!opts.dryRun) {
    await ensureDir(paths.agnosRoot);
    await ensureDir(paths.cacheDir);
    await ensureGitIgnore(opts.cwd, opts.logger);
  }

  const ctx = await buildResolveContext({
    projectRoot: opts.cwd,
    logger: opts.logger,
    dryRun: opts.dryRun ?? false,
  });
  const registry = await loadPlugins({ projectRoot: opts.cwd, logger: opts.logger });

  // 1) Run domain plugins' interactive init steps in priority order. Done
  //    before the agents picker so rules' setRulesSource sees no active
  //    agents (avoids redundant event dispatch since reinstate runs below).
  await runAllDomainInitSteps(
    registry,
    ctx,
    { yes: opts.yes, dryRun: opts.dryRun ?? false },
    opts.onlyIds,
  );

  // 2) Pick agents + offer skills.sh migration — skipped under --only.
  const scoped = opts.onlyIds && opts.onlyIds.length > 0;
  if (!scoped) {
    await promptAndPersistAgents(opts);
    await maybeMigrateSkillsLock(opts);
  }

  // 3) Single materialization pass.
  const config = await readConfigOrDefault(paths.configPath);
  await reinstate(config, registry, ctx, {
    copyOnNoSymlink: opts.copyOnNoSymlink,
    interactive: !opts.yes,
  });
}

async function maybeMigrateSkillsLock(opts: InitOptions): Promise<void> {
  const lockPath = path.join(opts.cwd, SKILLS_LOCK_FILE);
  try {
    await fs.access(lockPath);
  } catch {
    return;
  }

  const rel = path.relative(opts.cwd, lockPath) || SKILLS_LOCK_FILE;

  if (opts.yes) {
    opts.logger.info(
      `detected ${rel}; skipping migration under -y (run \`agnos skill migrate\` to import)`,
    );
    return;
  }

  const proceed = await confirm({
    message: `Detected ${rel} from skills.sh. Migrate those skills into agnos.json?`,
    default: true,
  });
  if (!proceed) return;

  const config = await readConfigOrDefault(buildPaths(opts.cwd).configPath);
  const ctx = await buildResolveContext({
    projectRoot: opts.cwd,
    logger: opts.logger,
    dryRun: opts.dryRun ?? false,
  });
  await runMigrate(
    {
      cwd: opts.cwd,
      sub: "migrate",
      args: [],
      noInstall: true,
      copyOnNoSymlink: opts.copyOnNoSymlink,
      dryRun: opts.dryRun ?? false,
      logger: opts.logger,
    },
    ctx,
    config,
    [],
  );
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
      "no agent plugins installed. Install `@luxia/agnos` to get the bundled defaults, or add one with `agnos agent add <id>`.",
    );
    return;
  }

  const currentIds = new Set((config.agents ?? []).map((ref) => refToId(registry, ref)));
  const selectedIds = await checkbox<string>({
    message: "Pick the agents to enable in this project:",
    choices: available.map((a) => {
      const suffix = a.source === "bundle" ? " (bundled)" : "";
      return {
        name: `${a.plugin.displayName} (${a.plugin.id}) — ${a.packageName}${suffix}`,
        value: a.plugin.id,
        checked: currentIds.has(a.plugin.id),
      };
    }),
  });

  const newRefs: AgentRef[] = selectedIds.map((id) => id);
  config.agents = newRefs;
  if (opts.dryRun) {
    opts.logger.info(`would: write agnos.json with ${selectedIds.length} agent(s)`);
  } else {
    await writeConfig(paths.configPath, config);
    opts.logger.success(
      `agnos.json updated (${selectedIds.length} agent${selectedIds.length === 1 ? "" : "s"} enabled)`,
    );
  }
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
    await fs.writeFile(rulesPath, await readDefaultRulesTemplate(), "utf8");
    return { created: true };
  }
}
