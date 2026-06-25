import fs from "node:fs/promises";
import path from "node:path";
import type { MaterializeContext } from "../../core/index.js";
import { ensureLink } from "../../core/index.js";

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
      await ensureLink(canonicalAbs, mirrorAbs, ctx.linker, { fallback: "copy" });
    } catch (err) {
      ctx.logger.warn(
        `rules: could not mirror ${agentFilename} for ${rel}: ${(err as Error).message}`,
      );
    }
  }
  return owned;
}

/** Compute the per-agent rule-mirror paths without writing (for claims/cleanup). */
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

/** Link the agent's skills dir to the canonical skills directory (dir-level link). */
export async function linkSkills(
  rel: string,
  canonicalDir: string,
  ctx: MaterializeContext,
): Promise<void> {
  const linkPath = path.resolve(ctx.projectRoot, rel);
  // No skills declared → ensure the link/copy is absent rather than linking an empty dir.
  if (!canonicalDir) {
    if (ctx.dryRun) {
      ctx.logger.info(`would: remove ${rel} (no skills)`);
      return;
    }
    await fs.rm(linkPath, { recursive: true, force: true }).catch(() => {});
    return;
  }
  if (ctx.dryRun) {
    ctx.logger.info(`would: link ${rel} → ${path.relative(ctx.projectRoot, canonicalDir)}`);
    return;
  }
  await fs.mkdir(canonicalDir, { recursive: true });
  try {
    await ensureLink(canonicalDir, linkPath, ctx.linker, { fallback: "copy" });
  } catch (err) {
    ctx.logger.warn(`skills: could not link ${rel}: ${(err as Error).message}`);
  }
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
