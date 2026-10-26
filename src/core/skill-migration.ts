import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { agnosConfigSchema } from "./schema.js";
import { parseCompositeSkillRef, skillRequestKey } from "./source.js";
import type { AgnosConfig, RepositoryRequest } from "./types/public.js";

const execFile = promisify(execFileCallback);
const COMMIT_RE = /^[a-f0-9]{7,64}$/i;

export interface SkillMigrationResult {
  migrated: string[];
  dryRun: boolean;
  config?: AgnosConfig;
}

export async function migrateLegacySkillSources(
  configPath: string,
  projectRoot: string,
  dryRun: boolean,
  log: (message: string) => void,
): Promise<SkillMigrationResult> {
  const raw = await fs.readFile(configPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (raw === undefined) return { migrated: [], dryRun };

  let config: unknown;
  try {
    config = JSON.parse(raw);
  } catch (error) {
    throw new Error(`agnos.json is not valid JSON: ${(error as Error).message}`, { cause: error });
  }
  if (!config || typeof config !== "object") return { migrated: [], dryRun };
  const skills = (config as Record<string, unknown>).skills;
  if (!skills || typeof skills !== "object") return { migrated: [], dryRun };
  const sources = (skills as Record<string, unknown>).sources;
  if (!sources || typeof sources !== "object" || Array.isArray(sources)) {
    return { migrated: [], dryRun };
  }

  const migrated: string[] = [];
  const normalized: Record<string, RepositoryRequest> = {};
  for (const [name, value] of Object.entries(sources)) {
    if (typeof value !== "string") {
      normalized[name] = value as RepositoryRequest;
      continue;
    }
    const parsed = parseCompositeSkillRef(value, { projectRoot });
    if (parsed.source.kind === "local") {
      normalized[name] = { source: parsed.source.canonical, glob: "." };
    } else {
      const request: RepositoryRequest = {
        source: `${parsed.source.provider}:${parsed.source.owner}/${parsed.source.repo}`,
        glob: parsed.subPath,
      };
      const ref = parsed.source.ref;
      if (ref && COMMIT_RE.test(ref)) request.commit = ref;
      else if (ref && !dryRun) {
        const tagCommit = await resolveTag(request.source, ref);
        if (tagCommit) request.commit = tagCommit;
        else request.branch = ref;
      } else if (ref) request.branch = ref;
      normalized[name] = request;
    }
    migrated.push(name);
  }

  if (migrated.length === 0) return { migrated, dryRun };
  log(`${dryRun ? "would: migrate" : "migrating"} ${migrated.length} legacy skill source(s)`);
  (skills as Record<string, unknown>).sources = normalized;
  const parsed = agnosConfigSchema.safeParse(config);
  if (!parsed.success) throw new Error(`migrated agnos.json is invalid:\n${parsed.error.message}`);
  if (!dryRun) {
    await migrateLegacyLock(
      path.dirname(configPath),
      sources as Record<string, unknown>,
      normalized,
    );
    const temporaryPath = `${configPath}.${process.pid}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    await fs.rename(temporaryPath, configPath);
  }
  return { migrated, dryRun, config: parsed.data as AgnosConfig };
}

async function migrateLegacyLock(
  projectRoot: string,
  legacySources: Record<string, unknown>,
  normalized: Record<string, RepositoryRequest>,
): Promise<void> {
  const lockPath = path.join(projectRoot, "agnos.lock.json");
  const raw = await fs.readFile(lockPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (raw === undefined) return;
  let lock: unknown;
  try {
    lock = JSON.parse(raw);
  } catch (error) {
    throw new Error(`agnos.lock.json is not valid JSON: ${(error as Error).message}`, {
      cause: error,
    });
  }
  if (!lock || typeof lock !== "object" || !("skills" in lock)) return;
  const entries = (lock as { skills: unknown }).skills;
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) return;
  let changed = false;
  let skills = entries as Record<string, unknown>;
  for (const [name, oldSource] of Object.entries(legacySources)) {
    if (typeof oldSource !== "string") continue;
    const request = normalized[name];
    const entry = skills[oldSource];
    if (!request || entry === undefined) continue;
    const key = skillRequestKey(request);
    if (skills[key] === undefined) skills[key] = entry;
    skills = Object.fromEntries(Object.entries(skills).filter(([key]) => key !== oldSource));
    changed = true;
  }
  if (changed) {
    (lock as { skills: unknown }).skills = skills;
    const temporaryPath = `${lockPath}.${process.pid}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
    await fs.rename(temporaryPath, lockPath);
  }
}

async function resolveTag(source: string, tag: string): Promise<string | undefined> {
  const [provider, repository] = source.split(":", 2);
  const [owner, repo] = (repository ?? "").split("/", 2);
  if (!provider || !owner || !repo) return undefined;
  const remote = `https://${provider === "github" ? "github.com" : provider === "gitlab" ? "gitlab.com" : "bitbucket.org"}/${owner}/${repo}.git`;
  try {
    const { stdout } = await execFile("git", [
      "ls-remote",
      remote,
      `refs/tags/${tag}`,
      `refs/tags/${tag}^{}`,
    ]);
    const refs = stdout
      .trim()
      .split(/\r?\n/)
      .map((line) => line.split(/\s+/));
    const hash = refs.find(([, ref]) => ref === `refs/tags/${tag}^{}`)?.[0] ?? refs[0]?.[0];
    return hash && /^[a-f0-9]{40,64}$/i.test(hash) ? hash : undefined;
  } catch {
    throw new Error(
      `could not inspect legacy ref "${tag}" from ${source} to distinguish a tag from a branch`,
    );
  }
}
