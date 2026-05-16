import path from "node:path";
import { confirm } from "@inquirer/prompts";
import { createLinker, predictRequiresFileSymlinks } from "./fs/link.js";
import { createSourceResolver } from "./resolver.js";
import { createLogger } from "./logger.js";
import { buildPaths, ensureDir } from "./paths.js";
import type { Logger, ResolveContext } from "./types/public.js";

export interface BuildContextOptions {
  projectRoot: string;
  copyFallback?: boolean;
  logger?: Logger;
}

export async function buildResolveContext(opts: BuildContextOptions): Promise<ResolveContext> {
  const paths = buildPaths(opts.projectRoot);
  await ensureDir(paths.agnosRoot);
  await ensureDir(paths.cacheDir);
  const logger = opts.logger ?? createLogger();
  const linker = createLinker({ cacheDir: paths.cacheDir, logger, copyFallback: opts.copyFallback });
  const fetcher = createSourceResolver({ projectRoot: opts.projectRoot, cacheDir: paths.cacheDir });
  return {
    projectRoot: opts.projectRoot,
    configPath: paths.configPath,
    statePath: paths.statePath,
    agnosRoot: paths.agnosRoot,
    cacheDir: paths.cacheDir,
    logger,
    fetcher,
    linker,
  };
}

export async function ensureSymlinkPrivileges(
  ctx: ResolveContext,
  plan: { fileSymlinks: boolean; dirSymlinks: boolean },
  opts: { interactive: boolean; autoCopy?: boolean } = { interactive: true },
): Promise<{ proceed: boolean; copyFallback: boolean }> {
  const needsFile = await predictRequiresFileSymlinks(plan);
  if (!needsFile) return { proceed: true, copyFallback: false };

  const ok = await ctx.linker.canSymlinkFiles();
  if (ok) return { proceed: true, copyFallback: false };

  if (opts.autoCopy) {
    ctx.logger.warn("file symlinks unavailable — falling back to copy (changes won't propagate across agents)");
    return { proceed: true, copyFallback: true };
  }

  if (!opts.interactive) {
    ctx.logger.error(
      "file symlinks unavailable in this session. Enable Developer Mode on Windows, or pass --copy-on-no-symlink.",
    );
    return { proceed: false, copyFallback: false };
  }

  const proceed = await confirm({
    message:
      "File symlinks aren't available in this session. Copy files instead? (Changes to the source won't propagate; agents may see stale rules.)",
    default: false,
  });
  if (!proceed) {
    ctx.logger.info("Aborting. Re-run from an elevated shell or enable Developer Mode (Windows).");
    return { proceed: false, copyFallback: false };
  }
  return { proceed: true, copyFallback: true };
}

export function rebuildContextWithCopyFallback(ctx: ResolveContext): ResolveContext {
  const linker = createLinker({ cacheDir: ctx.cacheDir, logger: ctx.logger, copyFallback: true });
  return { ...ctx, linker };
}

export function workspaceRelativePath(ctx: ResolveContext, p: string): string {
  const rel = path.relative(ctx.projectRoot, p);
  return rel.split(path.sep).join("/");
}
