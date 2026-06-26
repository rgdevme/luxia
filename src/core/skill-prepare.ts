import fs from "node:fs/promises";
import path from "node:path";
import { buildPaths } from "./paths.js";
import { getSkill, readLock, upsertSkill, writeLock } from "./lock.js";
import { parseCompositeSkillRef } from "./source.js";
import { hashSkillDir } from "./skill-hash.js";
import type { AgnosConfig, ResolveContext } from "./types/public.js";

const SKILL_MARKER = "SKILL.md";

export interface PrepareResult {
  /** Names of skills whose lock entries did not exist and were filled by this pre-pass. */
  filled: string[];
  /** Names of skills whose lock entries matched (no change). */
  verified: string[];
}

/**
 * Install-time pre-pass.
 *
 * For each declared skill in `config.skills.sources`:
 *  1. Parse the composite source, fetch the parent repo / open the local dir.
 *  2. Hash the materialized skill content at the recorded sub-path.
 *  3. Compare to the lock:
 *     - missing entry → write it (fresh-clone reproducibility).
 *     - match → proceed.
 *     - mismatch → fail loudly with a clear remediation step.
 *  4. Copy `<fetched>/<subPath>` to `<skillsDir>/<name>` so the canonical
 *     bytes are on disk before any agent hook runs.
 *
 * Returns a summary so callers can log what was filled vs. verified.
 */
export async function prepareSkills(
  config: AgnosConfig,
  ctx: ResolveContext,
): Promise<PrepareResult> {
  const result: PrepareResult = { filled: [], verified: [] };
  const entries = Object.entries(config.skills?.sources ?? {});
  if (entries.length === 0) return result;

  const lockBefore = await readLock(ctx.projectRoot);
  let lock = lockBefore;
  const skillsDir = buildPaths(ctx.projectRoot, config).skillsDir;
  if (!ctx.dryRun) await fs.mkdir(skillsDir, { recursive: true });

  for (const [name, composite] of entries) {
    const ref = parseCompositeSkillRef(composite, { projectRoot: ctx.projectRoot });
    const fetched = await ctx.fetcher.fetch(ref.source);
    const skillSrc =
      ref.source.kind === "git" ? path.join(fetched.path, ref.subPath) : fetched.path;

    if (!(await isSkillDir(skillSrc))) {
      throw new Error(
        `skill "${name}" not found at ${composite}` +
          ` — the path may have moved or been removed upstream.` +
          ` Re-bind with \`agnos skill add ${ref.source.canonical}\`.`,
      );
    }

    const hash = await hashSkillDir(skillSrc);
    const existing = getSkill(lock, composite);

    if (!existing) {
      if (ctx.dryRun) {
        ctx.logger.info(`would: pin ${name} (${composite}) → ${hash.slice(0, 12)}…`);
      } else {
        lock = upsertSkill(lock, composite, {
          computedHash: hash,
          resolvedAt: new Date().toISOString(),
        });
        ctx.logger.info(`pinned ${name} (${composite}) → ${hash.slice(0, 12)}…`);
      }
      result.filled.push(name);
    } else if (existing.computedHash !== hash) {
      throw new Error(
        `upstream content for "${name}" (${composite}) has changed since the lock was written.\n` +
          `  expected: ${existing.computedHash.slice(0, 12)}…\n` +
          `  got:      ${hash.slice(0, 12)}…\n` +
          `Run \`agnos skill update ${name}\` to accept the new content.`,
      );
    } else {
      result.verified.push(name);
    }

    if (!ctx.dryRun) {
      const dst = path.join(skillsDir, name);
      await fs.rm(dst, { recursive: true, force: true });
      await fs.cp(skillSrc, dst, { recursive: true, force: true });
    }
  }

  // Only write the lock if anything actually changed and we're not in dry-run.
  if (!ctx.dryRun && result.filled.length > 0) {
    await writeLock(ctx.projectRoot, lock);
  }

  return result;
}

async function isSkillDir(p: string): Promise<boolean> {
  try {
    const s = await fs.stat(p);
    if (!s.isDirectory()) return false;
    await fs.access(path.join(p, SKILL_MARKER));
    return true;
  } catch {
    return false;
  }
}
