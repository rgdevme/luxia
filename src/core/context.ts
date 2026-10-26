import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { createLinker } from "./fs/link.js";
import { createRepoFetcher } from "./resolver.js";
import { createLogger } from "./logger.js";
import { buildPaths } from "./paths.js";
import { readConfigOrDefault } from "./config.js";
import { resolveGlobalStoreDir } from "./store-path.js";
import { createRepositoryTracker } from "./repository-tracker.js";
import type { AgnosConfig, Logger, ResolveContext } from "./types/public.js";

export interface BuildContextOptions {
  projectRoot: string;
  copyFallback?: boolean;
  dryRun?: boolean;
  logger?: Logger;
  config?: AgnosConfig;
  storeDir?: string;
}

export async function buildResolveContext(opts: BuildContextOptions): Promise<ResolveContext> {
  const config =
    opts.config ?? (await readConfigOrDefault(path.join(opts.projectRoot, "agnos.json")));
  const paths = buildPaths(opts.projectRoot, config);
  const logger = opts.logger ?? createLogger();
  const operationTempDir = path.join(os.tmpdir(), `agnos-${randomUUID()}`);
  const linker = createLinker({
    probeDir: path.join(operationTempDir, "link-probes"),
    logger,
    copyFallback: opts.copyFallback,
  });
  const fetcher = createRepoFetcher({
    stagingDir: operationTempDir,
  });
  return {
    config,
    projectRoot: opts.projectRoot,
    configPath: paths.configPath,
    agnosRoot: paths.agnosRoot,
    storeDir: opts.storeDir ?? resolveGlobalStoreDir(),
    repositoryTracker: createRepositoryTracker({
      storeDir: opts.storeDir ?? resolveGlobalStoreDir(),
      logger,
    }),
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
