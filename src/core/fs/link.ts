import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { LinkKind, Linker, Logger } from "../types/public.js";

interface LinkerOptions {
  cacheDir: string;
  logger: Logger;
  copyFallback?: boolean;
}

export function createLinker({ cacheDir, logger, copyFallback }: LinkerOptions): Linker {
  let cachedFileProbe: boolean | undefined;

  async function probeFileSymlink(): Promise<boolean> {
    if (cachedFileProbe !== undefined) return cachedFileProbe;
    await fs.mkdir(cacheDir, { recursive: true });
    const probeDir = await fs.mkdtemp(path.join(cacheDir, "link-probe-"));
    const target = path.join(probeDir, "target");
    const link = path.join(probeDir, "link");
    try {
      await fs.writeFile(target, "");
      await fs.symlink(target, link, "file");
      cachedFileProbe = true;
    } catch (err) {
      logger.debug(`file symlink probe failed: ${(err as Error).message}`);
      cachedFileProbe = false;
    } finally {
      await fs.rm(probeDir, { recursive: true, force: true });
    }
    return cachedFileProbe;
  }

  return {
    async canSymlinkFiles() {
      return probeFileSymlink();
    },
    async canSymlinkDirs() {
      return true;
    },
    async link(target, linkPath, opts) {
      await fs.mkdir(path.dirname(linkPath), { recursive: true });
      await removeIfExists(linkPath);
      const absoluteTarget = path.isAbsolute(target)
        ? target
        : path.resolve(path.dirname(linkPath), target);
      const stat = await statOrNull(absoluteTarget);
      const isDir = stat?.isDirectory() ?? false;
      const isWin = process.platform === "win32";

      if (isWin && isDir) {
        await fs.symlink(absoluteTarget, linkPath, "junction");
        return { kind: "junction" satisfies LinkKind };
      }

      try {
        await fs.symlink(absoluteTarget, linkPath, isDir ? "dir" : "file");
        return { kind: "symlink" satisfies LinkKind };
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (
          (code === "EPERM" || code === "EACCES") &&
          (opts?.fallback === "copy" || copyFallback)
        ) {
          if (isDir) {
            await fs.cp(absoluteTarget, linkPath, { recursive: true });
          } else {
            await fs.copyFile(absoluteTarget, linkPath);
          }
          return { kind: "copy" satisfies LinkKind };
        }
        throw err;
      }
    },
    async unlink(linkPath) {
      await removeIfExists(linkPath);
    },
  };
}

export async function predictRequiresFileSymlinks(plan: {
  fileSymlinks: boolean;
  dirSymlinks: boolean;
}): Promise<boolean> {
  return plan.fileSymlinks;
}

export interface EnsureLinkResult {
  kind: LinkKind | "already-linked";
}

/**
 * Idempotent link: if `linkPath` already points to `target`, no-op. If it's a
 * stale symlink, replace it. If it's a real file/directory (not a link), throw
 * EEXIST — callers decide whether to migrate, prompt, or skip. Reuses
 * `linker.link` for the cross-OS junction/symlink/copy-fallback path.
 */
export async function ensureLink(
  target: string,
  linkPath: string,
  linker: Linker,
  opts?: { fallback?: "copy" },
): Promise<EnsureLinkResult> {
  const absTarget = path.resolve(target);
  const lstat = await fs.lstat(linkPath).catch(() => null);

  if (lstat?.isSymbolicLink()) {
    let resolvedCurrent = "";
    try {
      // realpath follows the link and normalizes Windows junction prefixes
      // like \\?\C:\... so comparison against a resolved absolute target works.
      resolvedCurrent = await fs.realpath(linkPath);
    } catch {
      // broken link — fall through to recreate
    }
    let resolvedTarget = absTarget;
    try {
      resolvedTarget = await fs.realpath(absTarget);
    } catch {
      // target may not exist yet in some edge cases; fall back to absTarget
    }
    if (resolvedCurrent && path.resolve(resolvedCurrent) === path.resolve(resolvedTarget)) {
      return { kind: "already-linked" };
    }
    await linker.unlink(linkPath);
    const out = await linker.link(absTarget, linkPath, opts);
    return { kind: out.kind };
  }

  if (lstat && (lstat.isDirectory() || lstat.isFile())) {
    // A prior copy-fallback materialization is a real file (not a symlink). If it
    // already matches the target byte-for-byte, it's effectively in place — skip,
    // so copy mode is idempotent too. A differing real file is a genuine conflict
    // (a user file we must not clobber).
    if (lstat.isFile()) {
      const [cur, tgt] = await Promise.all([
        fs.readFile(linkPath).catch(() => null),
        fs.readFile(absTarget).catch(() => null),
      ]);
      if (cur && tgt && cur.equals(tgt)) return { kind: "already-linked" };
    }
    const err = new Error(
      `cannot link ${linkPath}: a ${lstat.isDirectory() ? "directory" : "file"} already exists there`,
    ) as NodeJS.ErrnoException;
    err.code = "EEXIST";
    throw err;
  }

  const out = await linker.link(absTarget, linkPath, opts);
  return { kind: out.kind };
}

async function statOrNull(p: string) {
  try {
    return await fs.stat(p);
  } catch {
    return null;
  }
}

async function removeIfExists(p: string): Promise<void> {
  const lstat = await fs.lstat(p).catch(() => null);
  if (!lstat) return;
  if (lstat.isSymbolicLink() || lstat.isFile()) {
    await fs.unlink(p);
  } else if (lstat.isDirectory()) {
    await fs.rm(p, { recursive: true, force: true });
  }
}

export function describeSymlinkFailure(): string {
  const lines = [
    "Could not create file symlinks in this session.",
    process.platform === "win32"
      ? "  • Enable Developer Mode (Settings → System → For developers), or run from an elevated shell."
      : `  • Filesystem permissions on ${os.homedir()} may be too restrictive.`,
  ];
  return lines.join("\n");
}
