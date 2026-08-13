import fs from "node:fs/promises";
import path from "node:path";
import type { AgnosConfig, ResolveContext } from "../../core/index.js";
import {
  buildPaths,
  getSkill,
  hashSkillDir,
  materializeSkill,
  parseCompositeSkillRef,
  readLock,
  readState,
  removeSkill,
  resolveGitCommit,
  resolveLocalCommit,
  upsertSkill,
  writeLock,
  writeState,
} from "../../core/index.js";
import { ensureStoredSkill, findStoredSkill } from "../../core/skill-store.js";
import { runSkillTasks } from "./concurrency.js";
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
  /** Commit SHA of the checkout containing the skill. */
  commit?: string;
}

/**
 * Locate the fetched skill content for a composite ref (or null if missing).
 * An explicit checkout ref may be a locked commit while `trackedRef` remains
 * the symbolic branch or tag persisted for freshness checks.
 */
async function locate(
  composite: string,
  ctx: ResolveContext,
  options?: { checkoutRef?: string; trackedRef?: string; fresh?: boolean },
): Promise<LocateResult | null> {
  const parsed = parseCompositeSkillRef(composite, { projectRoot: ctx.projectRoot });
  const ownRef = parsed.source.kind === "git" ? parsed.source.ref : undefined;
  const checkoutRef = options?.checkoutRef ?? ownRef;
  const fetchOptions = {
    ...(checkoutRef ? { ref: checkoutRef } : {}),
    ...(options?.fresh ? { fresh: true } : {}),
  };
  const fetched = await ctx.fetcher.fetch(
    parsed.source,
    Object.keys(fetchOptions).length > 0 ? fetchOptions : undefined,
  );
  const src = parsed.source.kind === "git" ? path.join(fetched.path, parsed.subPath) : fetched.path;
  if (!(await isSkillDir(src))) return null;
  return {
    src,
    ...((options?.trackedRef ?? fetched.ref) ? { ref: options?.trackedRef ?? fetched.ref } : {}),
    ...(fetched.commit ? { commit: fetched.commit } : {}),
  };
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

export interface CreateSkillStepsOptions {
  verifyMaterialized?: boolean;
}

export interface PruneSkillsResult {
  removed: string[];
  unpinned: string[];
}

export async function pruneSkills(
  config: AgnosConfig,
  ctx: ResolveContext,
): Promise<PruneSkillsResult> {
  const sources = config.skills?.sources ?? {};
  const desiredNames = new Set(Object.keys(sources));
  const desiredSources = new Set(Object.values(sources));
  const skillsDir = buildPaths(ctx.projectRoot, config).skillsDir;
  let lock = await readLock(ctx.projectRoot);
  const state = await readState(ctx.statePath);
  let dirty = false;
  let stateDirty = false;
  const result: PruneSkillsResult = { removed: [], unpinned: [] };

  let children: string[];
  try {
    children = await fs.readdir(skillsDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    children = [];
  }

  for (const name of children) {
    if (desiredNames.has(name)) continue;
    const candidate = path.join(skillsDir, name);
    if (!(await isSkillDir(candidate))) continue;
    result.removed.push(name);
    if (ctx.dryRun) {
      ctx.logger.info(`would: remove skill "${name}"`);
    } else {
      await fs.rm(candidate, { recursive: true, force: true });
      if (state.materializedSkills?.[name]) {
        state.materializedSkills = Object.fromEntries(
          Object.entries(state.materializedSkills).filter(([skillName]) => skillName !== name),
        );
        stateDirty = true;
      }
    }
  }

  for (const source of Object.keys(lock.skills)) {
    if (desiredSources.has(source)) continue;
    result.unpinned.push(source);
    if (ctx.dryRun) {
      ctx.logger.info(`would: unpin skill source ${source}`);
    } else {
      lock = removeSkill(lock, source);
      dirty = true;
    }
  }

  if (dirty) await writeLock(ctx.projectRoot, lock);
  if (stateDirty) await writeState(ctx.statePath, state);
  return result;
}

/**
 * Concrete `SkillSteps` over the real fetcher + lock + content hash. The
 * `version` step compares the lock's `resolvedCommit` to the upstream HEAD
 * (treating an absent baseline or a network failure as "current" rather than
 * false-alarming); `install` imports content-addressed stored skills and pins
 * new skills.
 */
export async function createSkillSteps(
  config: AgnosConfig,
  ctx: ResolveContext,
  options?: CreateSkillStepsOptions,
): Promise<SkillStepsHandle> {
  const sources = config.skills?.sources ?? {};
  const skillsDir = buildPaths(ctx.projectRoot, config).skillsDir;
  let lock = await readLock(ctx.projectRoot);
  const state = await readState(ctx.statePath);
  let dirty = false;
  let stateDirty = false;

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
    async fetch(name, composite) {
      try {
        const parsed = parseCompositeSkillRef(composite, { projectRoot: ctx.projectRoot });
        const entry = getSkill(lock, composite);
        if (parsed.source.kind === "git" && entry) {
          let stored = await findStoredSkill(ctx.storeDir, entry.computedHash);
          if (!stored) {
            const legacyStore = path.join(ctx.agnosRoot, "cache");
            const legacy = await findStoredSkill(legacyStore, entry.computedHash);
            if (legacy) stored = await ensureStoredSkill(legacy, ctx.storeDir, entry.computedHash);
          }
          if (!stored) {
            const materialized = path.join(skillsDir, name);
            if ((await hashSkillDir(materialized).catch(() => null)) === entry.computedHash) {
              stored = await ensureStoredSkill(materialized, ctx.storeDir, entry.computedHash);
            }
          }
          if (stored && entry.resolvedCommit) {
            srcHashes.set(stored, entry.computedHash);
            const ref = parsed.source.ref ?? entry.ref;
            return {
              ok: true,
              src: stored,
              source: "reused",
              ...(ref ? { ref } : {}),
              ...(entry.resolvedCommit ? { commit: entry.resolvedCommit } : {}),
            };
          }
        }

        const trackedRef =
          parsed.source.kind === "git" ? (parsed.source.ref ?? entry?.ref) : undefined;
        const checkoutRef =
          parsed.source.kind === "git" ? (entry?.resolvedCommit ?? trackedRef) : undefined;
        const located = await locate(composite, ctx, {
          ...(checkoutRef ? { checkoutRef } : {}),
          ...(trackedRef ? { trackedRef } : {}),
        });
        return located
          ? {
              ok: true,
              src: located.src,
              source: "fetched",
              ...(located.ref ? { ref: located.ref } : {}),
              ...(located.commit ? { commit: located.commit } : {}),
            }
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
      const target = options?.verifyMaterialized ? path.join(skillsDir, name) : src;
      return (await hashOnce(target)) === entry.computedHash;
    },
    async install(name, src, ref, commit) {
      const composite = compositeOf(name);
      if (ctx.dryRun) {
        ctx.logger.info(`would: install skill "${name}"`);
        return;
      }
      const dst = path.join(skillsDir, name);
      const srcHash = await hashOnce(src);
      const stored = await ensureStoredSkill(src, ctx.storeDir, srcHash);
      await materializeSkill(stored, dst, srcHash, state.materializedSkills?.[name]);
      if (state.materializedSkills?.[name] !== srcHash) {
        state.materializedSkills = { ...(state.materializedSkills ?? {}), [name]: srcHash };
        stateDirty = true;
      }
      const existing = getSkill(lock, composite);
      if (!existing) {
        const parsed = parseCompositeSkillRef(composite, { projectRoot: ctx.projectRoot });
        if (parsed.source.kind === "git" && !commit) {
          throw new Error(`could not determine the checked-out commit for skill "${name}"`);
        }
        lock = upsertSkill(lock, composite, {
          computedHash: srcHash,
          resolvedAt: new Date().toISOString(),
          ...(commit ? { resolvedCommit: commit } : {}),
          ...(ref ? { ref } : {}),
        });
        dirty = true;
      } else if ((ref && !existing.ref) || (commit && !existing.resolvedCommit)) {
        lock = upsertSkill(lock, composite, {
          ...existing,
          ...(ref ? { ref } : {}),
          ...(commit ? { resolvedCommit: commit } : {}),
        });
        dirty = true;
      }
    },
  };

  return {
    steps,
    async flush() {
      if (dirty && !ctx.dryRun) await writeLock(ctx.projectRoot, lock);
      if (stateDirty && !ctx.dryRun) await writeState(ctx.statePath, state);
      if (!ctx.dryRun) {
        await cleanupLegacyCache(ctx, skillsDir, lock, Object.values(sources));
      }
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
  const targets = [...new Set(names.length > 0 ? names : Object.keys(sources))];
  const skillsDir = buildPaths(ctx.projectRoot, config).skillsDir;
  let lock = await readLock(ctx.projectRoot);
  const state = await readState(ctx.statePath);
  const updates = await runSkillTasks(targets, async (name) => {
    const composite = sources[name];
    if (!composite) throw new Error(`skill "${name}" is not declared`);
    const parsed = parseCompositeSkillRef(composite, { projectRoot: ctx.projectRoot });
    const trackedRef =
      parsed.source.kind === "git"
        ? (parsed.source.ref ?? getSkill(lock, composite)?.ref)
        : undefined;
    const located = await locate(composite, ctx, {
      ...(trackedRef ? { checkoutRef: trackedRef, trackedRef } : {}),
      fresh: true,
    });
    if (!located) throw new Error(`skill "${name}" not found at ${composite}`);
    const hash = await hashSkillDir(located.src);
    const commit = located.commit;
    if (parsed.source.kind === "git" && !commit) {
      throw new Error(`could not determine the checked-out commit for skill "${name}"`);
    }
    if (!ctx.dryRun) {
      const dst = path.join(skillsDir, name);
      const stored = await ensureStoredSkill(located.src, ctx.storeDir, hash);
      await materializeSkill(stored, dst, hash);
      state.materializedSkills = { ...(state.materializedSkills ?? {}), [name]: hash };
    }
    return { name, composite, hash, commit, ref: located.ref };
  });

  for (const update of updates) {
    lock = upsertSkill(lock, update.composite, {
      computedHash: update.hash,
      resolvedAt: new Date().toISOString(),
      ...(update.commit ? { resolvedCommit: update.commit } : {}),
      ...(update.ref ? { ref: update.ref } : {}),
    });
  }

  if (!ctx.dryRun && updates.length > 0) {
    await writeLock(ctx.projectRoot, lock);
    await writeState(ctx.statePath, state);
    await cleanupLegacyCache(ctx, skillsDir, lock, Object.values(sources));
  }
  return updates.map(({ name }) => name);
}

async function cleanupLegacyCache(
  ctx: ResolveContext,
  skillsDir: string,
  lock: Awaited<ReturnType<typeof readLock>>,
  declaredSources: string[],
): Promise<void> {
  const legacyCache = path.join(ctx.agnosRoot, "cache");
  const stat = await fs.lstat(legacyCache).catch(() => null);
  if (!stat) return;

  for (const source of declaredSources) {
    const entry = getSkill(lock, source);
    if (!entry) continue;
    if (!(await findStoredSkill(ctx.storeDir, entry.computedHash))) {
      ctx.logger.warn("legacy skill cache retained because migration is incomplete");
      return;
    }
  }

  const children = await fs.readdir(skillsDir).catch(() => []);
  for (const child of children) {
    const materialized = path.join(skillsDir, child);
    const childStat = await fs.lstat(materialized).catch(() => null);
    if (!childStat?.isSymbolicLink()) continue;
    const target = await fs.realpath(materialized).catch(() => null);
    if (target && isInside(target, legacyCache)) {
      ctx.logger.warn(`could not remove legacy skill cache because "${child}" still links to it`);
      return;
    }
  }

  try {
    await fs.rm(legacyCache, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } catch (error) {
    ctx.logger.warn(`could not remove legacy skill cache: ${(error as Error).message}`);
  }
}

function isInside(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}
