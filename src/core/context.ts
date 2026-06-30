import path from "node:path";
import { createLinker } from "./fs/link.js";
import { createRepoFetcher } from "./resolver.js";
import { createLogger } from "./logger.js";
import { buildPaths, ensureDir } from "./paths.js";
import { readConfigOrDefault } from "./config.js";
import type { AgnosConfig, Logger, ResolveContext } from "./types/public.js";

export interface BuildContextOptions {
  projectRoot: string;
  copyFallback?: boolean;
  dryRun?: boolean;
  logger?: Logger;
  config?: AgnosConfig;
}

export async function buildResolveContext(opts: BuildContextOptions): Promise<ResolveContext> {
  const config =
    opts.config ?? (await readConfigOrDefault(path.join(opts.projectRoot, "agnos.json")));
  const paths = buildPaths(opts.projectRoot, config);
  if (!opts.dryRun) {
    await ensureDir(paths.agnosRoot);
    await ensureDir(paths.cacheDir);
  }
  const logger = opts.logger ?? createLogger();
  const linker = createLinker({
    cacheDir: paths.cacheDir,
    logger,
    copyFallback: opts.copyFallback,
  });
  const fetcher = createRepoFetcher({ projectRoot: opts.projectRoot, cacheDir: paths.cacheDir });
  return {
    projectRoot: opts.projectRoot,
    configPath: paths.configPath,
    statePath: paths.statePath,
    agnosRoot: paths.agnosRoot,
    cacheDir: paths.cacheDir,
    logger,
    fetcher,
    linker,
    dryRun: opts.dryRun ?? false,
  };
}

export function workspaceRelativePath(ctx: ResolveContext, p: string): string {
  const rel = path.relative(ctx.projectRoot, p);
  return rel.split(path.sep).join("/");
}
