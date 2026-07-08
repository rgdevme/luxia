import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import picomatch from "picomatch";

const GLOB_PATTERN = /[*?[{(!+@]/;
const MATCH_OPTIONS = { dot: true, posixSlashes: true } as const;

export interface WalkEntry {
  absolutePath: string;
  relativePath: string;
  kind: "directory" | "file";
}

export function toPosixPath(value: string): string {
  return value.replace(/\\/g, "/");
}

export function normalizeRelativePath(value: string): string {
  return toPosixPath(value)
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "");
}

export function relativePosix(from: string, to: string): string {
  return toPosixPath(path.relative(from, to));
}

export function hasGlobPattern(value: string): boolean {
  return GLOB_PATTERN.test(value);
}

export function matchesRelativePatterns(
  relativePath: string,
  patterns: readonly string[],
): boolean {
  const normalizedPath = normalizeRelativePath(relativePath);

  return patterns.some((pattern) => {
    const normalizedPattern = normalizeRelativePath(pattern);
    if (!hasGlobPattern(normalizedPattern)) {
      return (
        normalizedPath === normalizedPattern || normalizedPath.startsWith(`${normalizedPattern}/`)
      );
    }

    return picomatch.isMatch(normalizedPath, normalizedPattern, MATCH_OPTIONS);
  });
}

export function matchesAbsolutePatterns(
  absolutePath: string,
  patterns: readonly string[],
): boolean {
  const normalizedPath = toPosixPath(path.resolve(absolutePath));

  return patterns.some((pattern) => {
    const normalizedPattern = toPosixPath(path.resolve(pattern));
    if (!hasGlobPattern(normalizedPattern)) {
      return (
        normalizedPath === normalizedPattern || normalizedPath.startsWith(`${normalizedPattern}/`)
      );
    }

    return picomatch.isMatch(normalizedPath, normalizedPattern, MATCH_OPTIONS);
  });
}

export async function walkEntries(root: string): Promise<WalkEntry[]> {
  const out: WalkEntry[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push({
          absolutePath,
          relativePath: relativePosix(root, absolutePath),
          kind: "directory",
        });
        await walk(absolutePath);
      } else if (entry.isFile()) {
        out.push({
          absolutePath,
          relativePath: relativePosix(root, absolutePath),
          kind: "file",
        });
      }
    }
  }

  await walk(root);
  return out;
}
