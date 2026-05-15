import fs from "node:fs/promises";
import path from "node:path";
import { input, select } from "@inquirer/prompts";
import { buildPaths } from "../paths.js";
import { readConfigOrDefault, writeConfig } from "../config.js";
import { ensureStarterRules } from "./init.js";
import { runInstallCommand } from "./install.js";
import type { Logger } from "../types/public.js";

export interface RulesOptions {
  cwd: string;
  path?: string | undefined;
  yes: boolean;
  logger: Logger;
}

export async function runRules(opts: RulesOptions): Promise<void> {
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
  target = normalizeRelPath(target);

  const oldAbs = path.resolve(opts.cwd, current);
  const newAbs = path.resolve(opts.cwd, target);

  if (path.relative(oldAbs, newAbs) === "") {
    // unchanged; just ensure the file exists
    const { created } = await ensureStarterRules(newAbs);
    if (created) opts.logger.success(`created ${target}`);
    if (!config.rules) {
      config.rules = { source: target };
      await writeConfig(paths.configPath, config);
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
    // !oldExists && newExists -- file's already where we want it
    opts.logger.info(`using existing ${target}`);
  }

  config.rules = { source: target };
  await writeConfig(paths.configPath, config);
  opts.logger.info(`agnos.json: rules.source = ${target}`);

  // re-install for any agents already enabled
  if (config.agents && config.agents.length > 0) {
    await runInstallCommand({ cwd: opts.cwd, logger: opts.logger });
  }
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
