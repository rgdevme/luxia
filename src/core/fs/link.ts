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
        if (code !== "EPERM" && code !== "EACCES") throw err;

        // File symlinks need elevation/Developer Mode on Windows. A hardlink
        // needs neither and keeps content in sync with the target (same inode),
        // so prefer it over a copy — but it only works for files on the same
        // volume. Fall through to copy when it can't be created.
        if (!isDir) {
          try {
            await fs.link(absoluteTarget, linkPath);
            return { kind: "hardlink" satisfies LinkKind };
          } catch (linkErr) {
            logger.debug(`hardlink failed for ${linkPath}: ${(linkErr as Error).message}`);
          }
        }

        if (opts?.fallback === "copy" || copyFallback) {
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

export interface EnsureLinkResult {
  kind: LinkKind | "already-linked";
}

/**
 * Idempotent link: if `linkPath` already points to `target`, no-op. If it's a
 * stale symlink, replace it. If it's a real file/directory (not a link) that
 * differs from the target, throw EEXIST — unless `opts.owned` marks the path as
 * agnos-managed, in which case it's replaced (e.g. a hardlink broken by a rename
 * or a stale copy). Reuses `linker.link` for the junction/symlink/hardlink/copy
 * path.
 */
export async function ensureLink(
  target: string,
  linkPath: string,
  linker: Linker,
  opts?: { fallback?: "copy"; owned?: boolean },
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
    if (lstat.isFile()) {
      // A hardlink to the target shares its inode — already in place, even
      // while the content is being rewritten. Check this before reading bytes:
      // it's cheaper and stays correct mid-edit.
      const [curStat, tgtStat] = await Promise.all([
        fs.stat(linkPath).catch(() => null),
        fs.stat(absTarget).catch(() => null),
      ]);
      if (
        curStat &&
        tgtStat &&
        curStat.ino !== 0 &&
        curStat.ino === tgtStat.ino &&
        curStat.dev === tgtStat.dev
      ) {
        return { kind: "already-linked" };
      }
      // A prior copy-fallback materialization is a real file. If it matches the
      // target byte-for-byte it's effectively in place — skip, so copy mode is
      // idempotent too.
      const [cur, tgt] = await Promise.all([
        fs.readFile(linkPath).catch(() => null),
        fs.readFile(absTarget).catch(() => null),
      ]);
      if (cur && tgt && cur.equals(tgt)) return { kind: "already-linked" };
    }
    // A real file/dir that differs from the target. If agnos owns this path (a
    // derived mirror/link target), replace it — a broken hardlink or stale copy.
    // Otherwise it's a user file we must not clobber: surface the conflict.
    if (opts?.owned) {
      await linker.unlink(linkPath);
      const out = await linker.link(absTarget, linkPath, opts);
      return { kind: out.kind };
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
