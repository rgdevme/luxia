import fs from "node:fs/promises";
import path from "node:path";
import type { LinkKind, MaterializeContext } from "../../core/index.js";
import { describeSymlinkFailure, ensureLink } from "../../core/index.js";

/**
 * Mirror each canonical rules file to the agent's own filename in the same
 * directory (e.g. canonical `./AGENTS.md` → `./CLAUDE.md`). Skips files that are
 * already in place (the agent reads the canonical filename directly), which also
 * satisfies the feedback-loop guard: an agent never writes a canonical file.
 * Returns the absolute paths it owns (for `claims`).
 */
export async function mirrorRules(
  canonicalPaths: string[],
  agentFilename: string,
  ctx: MaterializeContext,
): Promise<string[]> {
  const owned: string[] = [];
  const created: LinkKind[] = [];
  for (const rel of canonicalPaths) {
    const canonicalAbs = path.resolve(ctx.projectRoot, rel);
    const mirrorAbs = path.join(path.dirname(canonicalAbs), agentFilename);
    if (mirrorAbs === canonicalAbs) continue; // in-place; agent reads the canonical file
    owned.push(mirrorAbs);
    if (ctx.dryRun) {
      ctx.logger.info(`would: mirror ${agentFilename} next to ${rel}`);
      continue;
    }
    try {
      const { kind } = await ensureLink(canonicalAbs, mirrorAbs, ctx.linker, {
        fallback: "copy",
        owned: true,
      });
      if (kind !== "already-linked") created.push(kind);
    } catch (err) {
      ctx.logger.warn({
        message: `could not mirror ${agentFilename} for ${rel}`,
        status: (err as Error).message,
      });
    }
  }
  noteRuleLinkMode(created, agentFilename, ctx);
  return owned;
}

/**
 * One aggregated notice when freshly-created rule mirrors couldn't be real
 * symlinks. Hardlinks still keep content in sync; copies don't, so they warn.
 * Stays silent on steady-state runs (everything `already-linked`).
 */
function noteRuleLinkMode(
  created: LinkKind[],
  agentFilename: string,
  ctx: MaterializeContext,
): void {
  if (created.includes("copy")) {
    ctx.logger.warn({
      message: `copied ${agentFilename} (changes to the source won't propagate)`,
      extra: describeSymlinkFailure(),
    });
  } else if (created.includes("hardlink")) {
    ctx.logger.info(
      `hardlinked ${agentFilename} (content stays in sync). ` +
        `Enable Developer Mode / an elevated shell for symlinks.`,
    );
  }
}

/** Compute the per-harness rule-mirror paths without writing (for claims/cleanup). */
export function ruleMirrorPaths(
  canonicalPaths: string[],
  agentFilename: string,
  projectRoot: string,
): string[] {
  const out: string[] = [];
  for (const rel of canonicalPaths) {
    const canonicalAbs = path.resolve(projectRoot, rel);
    const mirrorAbs = path.join(path.dirname(canonicalAbs), agentFilename);
    if (mirrorAbs !== canonicalAbs) out.push(mirrorAbs);
  }
  return out;
}

/** Link each selected skill directory into the agent's skills directory. */
export async function linkSkills(
  rel: string,
  skills: Record<string, string>,
  ctx: MaterializeContext,
): Promise<void> {
  const linkPath = path.resolve(ctx.projectRoot, rel);
  const existing = await fs.lstat(linkPath).catch(() => null);
  if (existing?.isSymbolicLink()) {
    throw new Error(
      `legacy directory-level skills link exists at ${rel}; remove it manually before rendering individual skill links`,
    );
  }
  if (existing && !existing.isDirectory())
    throw new Error(`agent skills path is not a directory: ${rel}`);
  if (Object.keys(skills).length === 0) return;
  if (ctx.dryRun) {
    for (const [name, target] of Object.entries(skills)) {
      ctx.logger.info(`would: link ${rel}/${name} → ${path.relative(ctx.projectRoot, target)}`);
    }
    return;
  }
  await fs.mkdir(linkPath, { recursive: true });
  for (const [name, target] of Object.entries(skills)) {
    const destination = path.join(linkPath, name);
    const current = await fs.lstat(destination).catch(() => null);
    if (current && !current.isSymbolicLink()) {
      throw new Error(
        `cannot link skill "${name}": a real file or directory already exists at ${destination}`,
      );
    }
    await ensureLink(target, destination, ctx.linker);
  }
}

/**
 * Write `content` to `absPath` only if it differs from what's already there.
 * Returns whether a write happened. Skipping unchanged writes keeps renders
 * idempotent — no mtime churn, so the watch cascade doesn't re-fire (PRD §13.1).
 * Honors dry-run (logs the would-be write only when content would change).
 */
export async function writeIfChanged(
  absPath: string,
  content: string,
  ctx: MaterializeContext,
  label: string,
): Promise<boolean> {
  let existing: string | null;
  try {
    existing = await fs.readFile(absPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    existing = null;
  }
  if (existing === content) return false;
  if (ctx.dryRun) {
    ctx.logger.info(`would: write ${label}`);
    return true;
  }
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, content, "utf8");
  return true;
}

/** Best-effort removal of a list of owned paths (used by claims-based cleanup). */
export async function removePaths(paths: string[], ctx: MaterializeContext): Promise<void> {
  for (const p of paths) {
    if (ctx.dryRun) {
      ctx.logger.info(`would: remove ${path.relative(ctx.projectRoot, p)}`);
      continue;
    }
    await fs.rm(p, { recursive: true, force: true }).catch(() => {});
  }
}
