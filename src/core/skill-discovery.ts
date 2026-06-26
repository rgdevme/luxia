import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import matter from "gray-matter";

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
  /** `description` field from the SKILL.md frontmatter, if present (trimmed). */
  description?: string;
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
    const { title, description } = await readSkillMeta(marker);
    out.push({ path: rel, defaultName, title, description });
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

/** Cap how much of a SKILL.md we read for metadata — frontmatter + first heading
 * always live near the top, so reading the whole file would scale cost with body
 * size for no benefit. */
const META_PREFIX_BYTES = 16 * 1024;

/**
 * Read the human-facing metadata from a SKILL.md: the `description` frontmatter
 * field and the first markdown heading in the body. Reads only a bounded prefix.
 * Best-effort — any read or parse failure yields an empty result rather than
 * aborting discovery.
 */
async function readSkillMeta(skillMd: string): Promise<{ title?: string; description?: string }> {
  try {
    const fd = await fs.open(skillMd, "r");
    let head: string;
    try {
      const buf = Buffer.alloc(META_PREFIX_BYTES);
      const { bytesRead } = await fd.read(buf, 0, META_PREFIX_BYTES, 0);
      head = buf.toString("utf8", 0, bytesRead);
    } finally {
      await fd.close();
    }
    const parsed = matter(head);
    const rawDesc = parsed.data?.["description"];
    const description = typeof rawDesc === "string" ? rawDesc.trim() || undefined : undefined;
    const firstLine =
      parsed.content
        .split(/\r?\n/)
        .find((l) => l.trim() !== "")
        ?.trim() ?? "";
    const title = firstLine.startsWith("#")
      ? firstLine.replace(/^#+\s*/, "").trim() || undefined
      : undefined;
    return { title, description };
  } catch {
    return {};
  }
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}
