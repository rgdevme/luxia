import { buildPaths } from "../paths.js";
import { readConfig } from "../config.js";
import { loadPlugins } from "../plugin-loader.js";
import { buildResolveContext } from "../context.js";
import { reinstate } from "../orchestrator.js";
import type { Logger } from "../types/public.js";

export interface InstallCommandOptions {
  cwd: string;
  copyOnNoSymlink?: boolean;
  logger: Logger;
}

export async function runInstallCommand(opts: InstallCommandOptions): Promise<void> {
  const paths = buildPaths(opts.cwd);
  const config = await readConfig(paths.configPath);
  const ctx = await buildResolveContext({ projectRoot: opts.cwd, logger: opts.logger });
  const registry = await loadPlugins({ projectRoot: opts.cwd, logger: opts.logger });

  const result = await reinstate(config, registry, ctx, {
    copyOnNoSymlink: opts.copyOnNoSymlink ?? false,
    interactive: true,
  });
  if (!result.ok) process.exitCode = 1;
}
