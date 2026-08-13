import fs from "node:fs/promises";
import path from "node:path";
import { buildPaths } from "./paths.js";
import { getSkill, readLock, upsertSkill, writeLock } from "./lock.js";
import { parseCompositeSkillRef } from "./source.js";
import { hashSkillDir } from "./skill-hash.js";
import { ensureStoredSkill, findStoredSkill } from "./skill-store.js";
import { materializeSkill } from "./skill-materialize.js";
import { readState, writeState } from "./state.js";
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
 *  4. Store the content by hash and materialize `<skillsDir>/<name>` so the
 *     canonical bytes are available before any agent hook runs.
 *
 * Returns a summary so callers can log what was filled vs. verified.
 */
export async function prepareSkills(
  config: AgnosConfig,
  ctx: ResolveContext,
): Promise<PrepareResult> {
  try {
    return await prepareSkillsFromSources(config, ctx);
  } finally {
    await ctx.fetcher.cleanup();
  }
}

async function prepareSkillsFromSources(
  config: AgnosConfig,
  ctx: ResolveContext,
): Promise<PrepareResult> {
  const result: PrepareResult = { filled: [], verified: [] };
  const entries = Object.entries(config.skills?.sources ?? {});
  if (entries.length === 0) return result;

  const lockBefore = await readLock(ctx.projectRoot);
  let lock = lockBefore;
  let lockDirty = false;
  const state = await readState(ctx.statePath);
  let stateDirty = false;
  const skillsDir = buildPaths(ctx.projectRoot, config).skillsDir;
  if (!ctx.dryRun) await fs.mkdir(skillsDir, { recursive: true });

  for (const [name, composite] of entries) {
    const ref = parseCompositeSkillRef(composite, { projectRoot: ctx.projectRoot });
    const existing = getSkill(lock, composite);
    const located = await locatePreparedSkill(name, ref, existing, skillsDir, ctx);
    const skillSrc = located.path;

    if (!(await isSkillDir(skillSrc))) {
      throw new Error(
        `skill "${name}" not found at ${composite}` +
          ` — the path may have moved or been removed upstream.` +
          ` Re-bind with \`agnos skill add ${ref.source.canonical}\`.`,
      );
    }

    const hash = await hashSkillDir(skillSrc);
    if (!existing) {
      if (ref.source.kind === "git" && !located.commit) {
        throw new Error(`could not determine the checked-out commit for skill "${name}"`);
      }
      if (ctx.dryRun) {
        ctx.logger.info(`would: pin ${name} (${composite}) → ${hash.slice(0, 12)}…`);
      } else {
        lock = upsertSkill(lock, composite, {
          computedHash: hash,
          resolvedAt: new Date().toISOString(),
          ...(located.commit ? { resolvedCommit: located.commit } : {}),
          ...(located.ref ? { ref: located.ref } : {}),
        });
        lockDirty = true;
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
      if (ref.source.kind === "git" && located.commit && !existing.resolvedCommit) {
        lock = upsertSkill(lock, composite, { ...existing, resolvedCommit: located.commit });
        lockDirty = true;
      }
      result.verified.push(name);
    }

    if (!ctx.dryRun) {
      const dst = path.join(skillsDir, name);
      const stored = await ensureStoredSkill(skillSrc, ctx.storeDir, hash);
      await materializeSkill(stored, dst, hash, state.materializedSkills?.[name]);
      if (state.materializedSkills?.[name] !== hash) {
        state.materializedSkills = { ...(state.materializedSkills ?? {}), [name]: hash };
        stateDirty = true;
      }
    }
  }

  // Only write the lock if anything actually changed and we're not in dry-run.
  if (!ctx.dryRun && lockDirty) {
    await writeLock(ctx.projectRoot, lock);
  }
  if (!ctx.dryRun && stateDirty) await writeState(ctx.statePath, state);

  return result;
}

interface LocatedPreparedSkill {
  path: string;
  ref?: string;
  commit?: string;
}

async function locatePreparedSkill(
  name: string,
  composite: ReturnType<typeof parseCompositeSkillRef>,
  existing: ReturnType<typeof getSkill>,
  skillsDir: string,
  ctx: ResolveContext,
): Promise<LocatedPreparedSkill> {
  if (composite.source.kind === "local") return { path: composite.source.absolutePath };

  if (existing) {
    const global = await findStoredSkill(ctx.storeDir, existing.computedHash);
    if (global && existing.resolvedCommit) {
      return { path: global, ref: existing.ref, commit: existing.resolvedCommit };
    }

    const candidates = [
      path.join(skillsDir, name),
      path.join(ctx.agnosRoot, "cache", "skills", existing.computedHash),
    ];
    for (const candidate of candidates) {
      if ((await hashSkillDir(candidate).catch(() => null)) !== existing.computedHash) continue;
      const stored = await ensureStoredSkill(candidate, ctx.storeDir, existing.computedHash);
      if (existing.resolvedCommit) {
        return { path: stored, ref: existing.ref, commit: existing.resolvedCommit };
      }
    }
  }

  const trackedRef = composite.source.ref ?? existing?.ref;
  const checkoutRef = existing?.resolvedCommit ?? trackedRef;
  const fetched = await ctx.fetcher.fetch(
    composite.source,
    checkoutRef ? { ref: checkoutRef } : undefined,
  );
  return {
    path: path.join(fetched.path, composite.subPath),
    ...((trackedRef ?? fetched.ref) ? { ref: trackedRef ?? fetched.ref } : {}),
    ...(fetched.commit ? { commit: fetched.commit } : {}),
  };
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
