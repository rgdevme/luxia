import fs from "node:fs/promises";
import path from "node:path";
import type {
  AgnosConfig,
  RepositoryConsumer,
  RepositoryRequest,
  ResolveContext,
} from "../../core/index.js";
import {
  hashSkillDir,
  parseSkillRequest,
  skillRequestKey,
  readLock,
  upsertSkill,
  writeLock,
} from "../../core/index.js";
import { ensureStoredSkill } from "../../core/skill-store.js";
import type { FetchResult, SkillSteps } from "./pipeline.js";
import { HARNESS_ADAPTERS } from "../../harnesses/adapters/index.js";
import { validateSkillForHarnesses } from "../../core/skill-metadata.js";

function skillConsumer(ctx: ResolveContext, name: string): RepositoryConsumer {
  return { projectId: path.resolve(ctx.configPath), domain: "skills", name };
}

async function locateSkill(
  name: string,
  request: RepositoryRequest,
  ctx: ResolveContext,
  fresh = false,
): Promise<FetchResult> {
  const parsed = parseSkillRequest(request, { projectRoot: ctx.projectRoot });
  if (parsed.source.kind === "git") {
    const info = await ctx.repositoryTracker.add(
      {
        source:
          parsed.source.remoteUrl ??
          `${parsed.source.provider}:${parsed.source.owner}/${parsed.source.repo}`,
        ...(request.branch ? { branch: request.branch } : {}),
        ...(request.commit ? { commit: request.commit } : {}),
        glob: parsed.subPath,
      },
      skillConsumer(ctx, name),
    );
    const resolved =
      fresh && !request.commit ? await ctx.repositoryTracker.update(info.trackingId) : info;
    const selected = resolved.entries.filter((entry) => entry.kind === "directory");
    if (selected.length !== 1)
      throw new Error(`skill "${name}" must select exactly one repository directory`);
    const source = selected[0];
    if (!source) throw new Error(`skill "${name}" selection is missing`);
    return {
      ok: true,
      src: source.absolutePath,
      source: fresh ? "fetched" : "reused",
      ref: resolved.branch,
      commit: resolved.commit,
    };
  }
  const fetched = await ctx.fetcher.fetch(parsed.source);
  const marker = path.join(fetched.path, "SKILL.md");
  await fs.access(marker);
  return {
    ok: true,
    src: fetched.path,
    source: "fetched",
    ...(fetched.ref ? { ref: fetched.ref } : {}),
    ...(fetched.commit ? { commit: fetched.commit } : {}),
  };
}

export interface SkillStepsHandle {
  steps: SkillSteps;
  flush(): Promise<void>;
}

export interface CreateSkillStepsOptions {
  verifyMaterialized?: boolean;
}

export async function resolveSkillTargets(
  config: AgnosConfig,
  ctx: ResolveContext,
): Promise<Record<string, string>> {
  const targets: Record<string, string> = {};
  const sources = config.skills?.sources ?? {};
  for (const [name, request] of Object.entries(sources)) {
    try {
      const result = await locateSkill(name, request, ctx);
      if (result.ok && result.src) targets[name] = result.src;
    } catch (error) {
      ctx.logger.warn(`skill "${name}" is unavailable: ${(error as Error).message}`);
    }
  }
  const localRoot = config.skills?.dir ?? ".agnos/skills";
  const localSkillsDirectory = path.isAbsolute(localRoot)
    ? localRoot
    : path.resolve(ctx.projectRoot, localRoot);
  const entries = await fs
    .readdir(localSkillsDirectory, { withFileTypes: true })
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillPath = path.join(localSkillsDirectory, entry.name);
    try {
      await fs.access(path.join(skillPath, "SKILL.md"));
      targets[entry.name] = skillPath;
    } catch {
      continue;
    }
  }
  return targets;
}

export async function createSkillSteps(
  config: AgnosConfig,
  ctx: ResolveContext,
  _options?: CreateSkillStepsOptions,
): Promise<SkillStepsHandle> {
  const sources = config.skills?.sources ?? {};
  let lock = await readLock(ctx.projectRoot);
  let dirty = false;
  const located = new Map<string, FetchResult>();
  const harnesses = HARNESS_ADAPTERS.filter((harness) =>
    (config.harness ?? []).includes(harness.id),
  );
  const compositeOf = (name: string): RepositoryRequest => {
    const request = sources[name];
    if (!request) throw new Error(`skill "${name}" is not declared`);
    return request;
  };
  const steps: SkillSteps = {
    async fetch(name, request) {
      try {
        if (ctx.dryRun) {
          ctx.logger.info(`would: resolve skill source "${name}"`);
          return { ok: false };
        }
        const result = await locateSkill(name, request, ctx);
        located.set(name, result);
        return result;
      } catch {
        return { ok: false };
      }
    },
    async version(name) {
      const request = compositeOf(name);
      if (request.commit) return true;
      const registrations = await ctx.repositoryTracker.listRegistrations(skillConsumer(ctx, name));
      const registration = registrations.find((item) => item.request.source === request.source);
      if (!registration) return true;
      return !(await ctx.repositoryTracker.shouldUpdate(registration.trackingId));
    },
    async integrity(name, source) {
      const request = compositeOf(name);
      const entry = lock.skills[skillRequestKey(request)];
      const parsed = parseSkillRequest(request, { projectRoot: ctx.projectRoot });
      const latest = located.get(name);
      if (
        entry?.resolvedCommit &&
        parsed.source.kind === "git" &&
        latest?.commit &&
        entry.resolvedCommit !== latest.commit
      ) {
        return true;
      }
      return !entry || (await hashSkillDir(source)) === entry.computedHash;
    },
    async validate(name, source) {
      const findings = await validateSkillForHarnesses(name, source, harnesses);
      for (const finding of findings) {
        ctx.logger.warn({
          message: `${finding.harnessId}: skill "${finding.skillName}" ${finding.message}`,
          status: finding.file,
        });
      }
    },
    async install(name, source, ref, commit) {
      const request = compositeOf(name);
      const key = skillRequestKey(request);
      const hash = await hashSkillDir(source);
      const parsed = parseSkillRequest(request, { projectRoot: ctx.projectRoot });
      if (parsed.source.kind !== "git") await ensureStoredSkill(source, ctx.storeDir, hash);
      const current = lock.skills[key];
      if (
        !current ||
        current.computedHash !== hash ||
        current.resolvedCommit !== commit ||
        current.ref !== ref
      ) {
        lock = upsertSkill(lock, key, {
          computedHash: hash,
          resolvedAt: new Date().toISOString(),
          ...(commit ? { resolvedCommit: commit } : {}),
          ...(ref ? { ref } : {}),
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

export async function updateSkills(
  names: string[],
  config: AgnosConfig,
  ctx: ResolveContext,
): Promise<string[]> {
  const sources = config.skills?.sources ?? {};
  const targets = names.length > 0 ? names : Object.keys(sources);
  let lock = await readLock(ctx.projectRoot);
  const updated: string[] = [];
  const failures: Error[] = [];
  for (const name of targets) {
    const request = sources[name];
    if (!request) throw new Error(`skill "${name}" is not declared`);
    if (request.commit) {
      ctx.logger.info(`skipping pinned skill "${name}"`);
      continue;
    }
    try {
      const registrations = await ctx.repositoryTracker.listRegistrations(skillConsumer(ctx, name));
      const registration = registrations.find((item) => item.request.source === request.source);
      if (!registration)
        throw new Error(`skill "${name}" is not installed; run agnos skills install`);
      const info = await ctx.repositoryTracker.update(registration.trackingId);
      const key = skillRequestKey(request);
      const selected = info.entries.filter((entry) => entry.kind === "directory");
      if (selected.length !== 1 || !selected[0])
        throw new Error(`skill "${name}" selection no longer resolves to one directory`);
      const hash = await hashSkillDir(selected[0].absolutePath);
      const harnesses = HARNESS_ADAPTERS.filter((harness) =>
        (config.harness ?? []).includes(harness.id),
      );
      const findings = await validateSkillForHarnesses(name, selected[0].absolutePath, harnesses);
      for (const finding of findings) {
        ctx.logger.warn({
          message: `${finding.harnessId}: skill "${finding.skillName}" ${finding.message}`,
          status: finding.file,
        });
      }
      const previous = lock.skills[key];
      lock = upsertSkill(lock, key, {
        ...(previous ?? {}),
        computedHash: hash,
        resolvedAt: new Date().toISOString(),
        resolvedCommit: info.commit,
        ref: info.branch,
      });
      updated.push(name);
    } catch (error) {
      failures.push(error instanceof Error ? error : new Error(String(error)));
    }
  }
  if (updated.length > 0 && !ctx.dryRun) await writeLock(ctx.projectRoot, lock);
  if (failures.length > 0)
    throw new AggregateError(failures, "one or more skills failed to update");
  return updated;
}
