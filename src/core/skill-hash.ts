import { createHash, type Hash } from "node:crypto";
import fs from "node:fs";
import type { Dirent } from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

/**
 * Deterministic content hash of a skill directory.
 *
 * Algorithm: SHA-256 of a canonical encoding of the directory's regular files.
 * For each file, sorted by its POSIX-style relative path (case-sensitive), the
 * hash absorbs:
 *
 *   <rel-posix-path>\n<size-decimal>\n<file-bytes>\n
 *
 * Symlinks, sockets, devices, and the like are ignored. Directories don't
 * contribute on their own — only the files within them do.
 *
 * This format is deliberately simple and stable across platforms. It is NOT
 * compatible with git's tree-hash (different framing, no mode bits).
 */
export async function hashSkillDir(absDir: string): Promise<string> {
  const files = await collectFiles(absDir, absDir);
  files.sort((a, b) => (a.relPosix < b.relPosix ? -1 : a.relPosix > b.relPosix ? 1 : 0));
  const hash = createHash("sha256");
  for (const f of files) {
    hash.update(f.relPosix);
    hash.update("\n");
    hash.update(String(f.size));
    hash.update("\n");
    await pipeFileInto(f.abs, hash);
    hash.update("\n");
  }
  return hash.digest("hex");
}

interface FileEntry {
  abs: string;
  relPosix: string;
  size: number;
}

async function collectFiles(root: string, dir: string): Promise<FileEntry[]> {
  let entries: Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const out: FileEntry[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) {
      const nested = await collectFiles(root, full);
      out.push(...nested);
      continue;
    }
    if (!e.isFile()) continue;
    const stat = await fsp.stat(full);
    out.push({
      abs: full,
      relPosix: path.relative(root, full).split(path.sep).join("/"),
      size: stat.size,
    });
  }
  return out;
}

function pipeFileInto(abs: string, hash: Hash): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(abs);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve());
    stream.on("error", (err) => reject(err));
  });
}
