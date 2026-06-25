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

/** Locate the fetched skill content for a composite ref (or null if missing). */
async function locate(composite: string, ctx: ResolveContext): Promise<string | null> {
  const ref = parseCompositeSkillRef(composite, { projectRoot: ctx.projectRoot });
  const fetched = await ctx.fetcher.fetch(ref.source);
  const src = ref.source.kind === "git" ? path.join(fetched.path, ref.subPath) : fetched.path;
  return (await isSkillDir(src)) ? src : null;
}

/** Best-effort upstream commit for the ref (undefined on any failure / no network). */
async function resolveCommit(composite: string, ctx: ResolveContext): Promise<string | undefined> {
  const ref = parseCompositeSkillRef(composite, { projectRoot: ctx.projectRoot });
  try {
    const res =
      ref.source.kind === "git"
        ? await resolveGitCommit(ref.source)
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

  const compositeOf = (name: string): string => {
    const c = sources[name];
    if (!c) throw new Error(`skill "${name}" is not declared`);
    return c;
  };

  const steps: SkillSteps = {
    async fetch(_name, composite) {
      try {
        const src = await locate(composite, ctx);
        return src ? { ok: true, src } : { ok: false };
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
      return (await hashSkillDir(src)) === entry.computedHash;
    },
    async install(name, src) {
      const composite = compositeOf(name);
      if (ctx.dryRun) {
        ctx.logger.info(`would: install skill "${name}"`);
        return;
      }
      const dst = path.join(skillsDir, name);
      const srcHash = await hashSkillDir(src);
      const dstHash = (await isSkillDir(dst)) ? await hashSkillDir(dst) : null;
      if (dstHash !== srcHash) {
        await fs.rm(dst, { recursive: true, force: true });
        await fs.mkdir(path.dirname(dst), { recursive: true });
        await fs.cp(src, dst, { recursive: true, force: true });
      }
      if (!getSkill(lock, composite)) {
        const commit = await resolveCommit(composite, ctx);
        lock = upsertSkill(lock, composite, {
          computedHash: srcHash,
          resolvedAt: new Date().toISOString(),
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
    const src = await locate(composite, ctx);
    if (!src) throw new Error(`skill "${name}" not found at ${composite}`);
    const hash = await hashSkillDir(src);
    const commit = await resolveCommit(composite, ctx);
    lock = upsertSkill(lock, composite, {
      computedHash: hash,
      resolvedAt: new Date().toISOString(),
      ...(commit ? { resolvedCommit: commit } : {}),
    });
    if (!ctx.dryRun) {
      const dst = path.join(skillsDir, name);
      await fs.rm(dst, { recursive: true, force: true });
      await fs.mkdir(path.dirname(dst), { recursive: true });
      await fs.cp(src, dst, { recursive: true, force: true });
    }
    updated.push(name);
  }

  if (!ctx.dryRun && updated.length > 0) await writeLock(ctx.projectRoot, lock);
  return updated;
}
