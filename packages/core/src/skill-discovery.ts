import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";

const SKILL_MARKER = "SKILL.md";

/**
 * Directories that the walker skips wholesale. Mostly common build / VCS
 * artifacts that should never contain real skills.
 */
const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  ".agnos",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".cache",
  ".vercel",
  "target",
  "__pycache__",
  ".venv",
  "venv",
  ".pytest_cache",
  ".mypy_cache",
  ".tox",
]);

/** Hard cap on directory depth so a runaway repo can't burn forever. */
const MAX_DEPTH = 10;

export interface DiscoveredSkill {
  /** POSIX-style path relative to the repo root, identifying the skill directory. */
  path: string;
  /** Default local name — the basename of the skill directory. */
  defaultName: string;
  /** First markdown heading in SKILL.md, if present (trimmed, leading "# " stripped). */
  title?: string;
}

/**
 * Walk `repoRoot` for any directory containing a `SKILL.md` file. Skips the
 * standard build/VCS directories. Doesn't descend into a skill directory after
 * finding its SKILL.md (skills are atomic units; nested skills are not a thing).
 *
 * Returns a stable order (sorted by path) so the interactive prompt and any
 * collision-suffixing are deterministic.
 */
export async function findSkillsInRepo(repoRoot: string): Promise<DiscoveredSkill[]> {
  const out: DiscoveredSkill[] = [];
  await walk(repoRoot, repoRoot, 0, out);
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

async function walk(
  repoRoot: string,
  dir: string,
  depth: number,
  out: DiscoveredSkill[],
): Promise<void> {
  if (depth > MAX_DEPTH) return;

  // Does this directory itself contain a SKILL.md? If yes, treat the directory
  // as a skill and don't descend further.
  const marker = path.join(dir, SKILL_MARKER);
  if (await fileExists(marker)) {
    const rel = toPosix(path.relative(repoRoot, dir));
    if (rel === "") return; // SKILL.md at repo root is not a "skill" per se
    const defaultName = path.basename(dir);
    const title = await readTitle(marker);
    out.push({ path: rel, defaultName, title });
    return;
  }

  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (IGNORED_DIRS.has(e.name)) continue;
    if (e.name.startsWith(".") && e.name !== ".") continue; // skip dotdirs by default
    await walk(repoRoot, path.join(dir, e.name), depth + 1, out);
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    const s = await fs.stat(p);
    return s.isFile();
  } catch {
    return false;
  }
}

async function readTitle(skillMd: string): Promise<string | undefined> {
  try {
    const fd = await fs.open(skillMd, "r");
    try {
      const buf = Buffer.alloc(512);
      const { bytesRead } = await fd.read(buf, 0, 512, 0);
      const head = buf.toString("utf8", 0, bytesRead);
      const firstLine = head.split(/\r?\n/, 1)[0]?.trim() ?? "";
      if (firstLine.startsWith("#")) return firstLine.replace(/^#+\s*/, "").trim() || undefined;
      return undefined;
    } finally {
      await fd.close();
    }
  } catch {
    return undefined;
  }
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}
