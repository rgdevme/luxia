import fs from "node:fs/promises";
import path from "node:path";
import type { AgnosConfig, ResolveContext } from "../../core/index.js";
import {
  buildPaths,
  getSkill,
  hashSkillDir,
  parseCompositeSkillRef,
  readLock,
  resolveGitCommit,
  resolveLocalCommit,
  upsertSkill,
  writeLock,
} from "../../core/index.js";
import type { SkillSteps } from "./pipeline.js";

const SKILL_MARKER = "SKILL.md";

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

interface LocateResult {
  /** Absolute path to the fetched skill content. */
  src: string;
  /** Branch/tag actually fetched (for git sources) — persisted to the lock. */
  ref?: string;
}

/**
 * Locate the fetched skill content for a composite ref (or null if missing).
 * `lockedRef` is the branch/tag recorded in the lock: passing it as the explicit
 * fetch ref lets `fetchGit` skip the `ls-remote` default-branch lookup and hit
 * the cache directly, so warm runs are fully offline.
 */
async function locate(
  composite: string,
  ctx: ResolveContext,
  lockedRef?: string,
): Promise<LocateResult | null> {
  const parsed = parseCompositeSkillRef(composite, { projectRoot: ctx.projectRoot });
  const ownRef = parsed.source.kind === "git" ? parsed.source.ref : undefined;
  const explicit = ownRef ?? lockedRef;
  const fetched = await ctx.fetcher.fetch(parsed.source, explicit ? { ref: explicit } : undefined);
  const src = parsed.source.kind === "git" ? path.join(fetched.path, parsed.subPath) : fetched.path;
  if (!(await isSkillDir(src))) return null;
  return { src, ...(fetched.ref ? { ref: fetched.ref } : {}) };
}

/** Best-effort upstream commit for the ref (undefined on any failure / no network). */
async function resolveCommit(composite: string, ctx: ResolveContext): Promise<string | undefined> {
  const ref = parseCompositeSkillRef(composite, { projectRoot: ctx.projectRoot });
  try {
    const res =
      ref.source.kind === "git"
        ? await resolveGitCommit(ref.source, ref.source.ref)
        : await resolveLocalCommit(ref.source);
    return res.commit ?? undefined;
  } catch {
    return undefined;
  }
}

export interface SkillStepsHandle {
  steps: SkillSteps;
  /** Persist the lock if `install` pinned any new skills. */
  flush(): Promise<void>;
}

/**
 * Concrete `SkillSteps` over the real fetcher + lock + content hash. The
 * `version` step compares the lock's `resolvedCommit` to the upstream HEAD
 * (treating an absent baseline or a network failure as "current" rather than
 * false-alarming); `install` is copy-if-changed and pins new skills.
 */
export async function createSkillSteps(
  config: AgnosConfig,
  ctx: ResolveContext,
): Promise<SkillStepsHandle> {
  const sources = config.skills?.sources ?? {};
  const skillsDir = buildPaths(ctx.projectRoot, config).skillsDir;
  let lock = await readLock(ctx.projectRoot);
  let dirty = false;

  // Hash each fetched source directory at most once per run — `integrity` and
  // `install` both need the source hash, and the source tree is immutable.
  const srcHashes = new Map<string, string>();
  const hashOnce = async (dir: string): Promise<string> => {
    const cached = srcHashes.get(dir);
    if (cached !== undefined) return cached;
    const h = await hashSkillDir(dir);
    srcHashes.set(dir, h);
    return h;
  };

  const compositeOf = (name: string): string => {
    const c = sources[name];
    if (!c) throw new Error(`skill "${name}" is not declared`);
    return c;
  };

  const steps: SkillSteps = {
    async fetch(_name, composite) {
      try {
        const lockedRef = getSkill(lock, composite)?.ref;
        const located = await locate(composite, ctx, lockedRef);
        return located
          ? { ok: true, src: located.src, ...(located.ref ? { ref: located.ref } : {}) }
          : { ok: false };
      } catch {
        return { ok: false };
      }
    },
    async version(name, _src) {
      const composite = compositeOf(name);
      const entry = getSkill(lock, composite);
      if (!entry?.resolvedCommit) return true; // no baseline → can't tell
      const latest = await resolveCommit(composite, ctx);
      return latest === undefined || latest === entry.resolvedCommit;
    },
    async integrity(name, src) {
      const entry = getSkill(lock, compositeOf(name));
      if (!entry) return true; // unpinned → install will pin it
      return (await hashOnce(src)) === entry.computedHash;
    },
    async install(name, src, ref) {
      const composite = compositeOf(name);
      if (ctx.dryRun) {
        ctx.logger.info(`would: install skill "${name}"`);
        return;
      }
      const dst = path.join(skillsDir, name);
      const srcHash = await hashOnce(src);
      const dstHash = (await isSkillDir(dst)) ? await hashSkillDir(dst) : null;
      if (dstHash !== srcHash) {
        await fs.rm(dst, { recursive: true, force: true });
        await fs.mkdir(path.dirname(dst), { recursive: true });
        await fs.cp(src, dst, { recursive: true, force: true });
      }
      const existing = getSkill(lock, composite);
      if (!existing) {
        const commit = await resolveCommit(composite, ctx);
        lock = upsertSkill(lock, composite, {
          computedHash: srcHash,
          resolvedAt: new Date().toISOString(),
          ...(commit ? { resolvedCommit: commit } : {}),
          ...(ref ? { ref } : {}),
        });
        dirty = true;
      } else if (ref && !existing.ref) {
        // Backfill the tracked ref for legacy lock entries so subsequent runs
        // fetch offline (no `ls-remote`). Self-heals after one run.
        lock = upsertSkill(lock, composite, { ...existing, ref });
        dirty = true;
      }
    },
  };

  return {
    steps,
    async flush() {
      if (dirty && !ctx.dryRun) await writeLock(ctx.projectRoot, lock);
    },
  };
}

/**
 * Re-pin skills: accept the current upstream content (overwrite the lock entry
 * with a fresh hash + commit) and re-install. The remediation `agnos skills
 * update` points to. `names` empty → every declared skill.
 */
export async function updateSkills(
  names: string[],
  config: AgnosConfig,
  ctx: ResolveContext,
): Promise<string[]> {
  const sources = config.skills?.sources ?? {};
  const targets = names.length > 0 ? names : Object.keys(sources);
  const skillsDir = buildPaths(ctx.projectRoot, config).skillsDir;
  let lock = await readLock(ctx.projectRoot);
  const updated: string[] = [];

  for (const name of targets) {
    const composite = sources[name];
    if (!composite) throw new Error(`skill "${name}" is not declared`);
    const located = await locate(composite, ctx, getSkill(lock, composite)?.ref);
    if (!located) throw new Error(`skill "${name}" not found at ${composite}`);
    const hash = await hashSkillDir(located.src);
    const commit = await resolveCommit(composite, ctx);
    lock = upsertSkill(lock, composite, {
      computedHash: hash,
      resolvedAt: new Date().toISOString(),
      ...(commit ? { resolvedCommit: commit } : {}),
      ...(located.ref ? { ref: located.ref } : {}),
    });
    if (!ctx.dryRun) {
      const dst = path.join(skillsDir, name);
      await fs.rm(dst, { recursive: true, force: true });
      await fs.mkdir(path.dirname(dst), { recursive: true });
      await fs.cp(located.src, dst, { recursive: true, force: true });
    }
    updated.push(name);
  }

  if (!ctx.dryRun && updated.length > 0) await writeLock(ctx.projectRoot, lock);
  return updated;
}
