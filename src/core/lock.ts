import fs from "node:fs/promises";
import path from "node:path";
import { lockFileSchema } from "./schema.js";
import type { LockFile, SkillLockEntry } from "./types/public.js";

export const LOCK_FILE = "agnos.lock.json";

export function lockPath(projectRoot: string): string {
  return path.join(projectRoot, LOCK_FILE);
}

export function emptyLock(): LockFile {
  return { version: 1, skills: {} };
}

export async function readLock(projectRoot: string): Promise<LockFile> {
  const p = lockPath(projectRoot);
  let raw: string;
  try {
    raw = await fs.readFile(p, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyLock();
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${LOCK_FILE} is not valid JSON: ${(err as Error).message}`);
  }
  const result = lockFileSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`${LOCK_FILE} schema validation failed:\n${result.error.message}`);
  }
  return result.data;
}

export async function writeLock(projectRoot: string, lock: LockFile): Promise<void> {
  const p = lockPath(projectRoot);
  // Stable key order for diff-friendly commits.
  const orderedKeys = Object.keys(lock.skills).sort();
  const orderedSkills: Record<string, SkillLockEntry> = {};
  for (const k of orderedKeys) orderedSkills[k] = lock.skills[k]!;
  const ordered: LockFile = { version: lock.version, skills: orderedSkills };
  const json = JSON.stringify(ordered, null, 2) + "\n";
  await fs.writeFile(p, json, "utf8");
}

export function upsertSkill(lock: LockFile, key: string, entry: SkillLockEntry): LockFile {
  return {
    ...lock,
    skills: { ...lock.skills, [key]: entry },
  };
}

export function removeSkill(lock: LockFile, key: string): LockFile {
  if (!(key in lock.skills)) return lock;
  const { [key]: _removed, ...skills } = lock.skills;
  void _removed;
  return { ...lock, skills };
}

export function getSkill(lock: LockFile, key: string): SkillLockEntry | undefined {
  return lock.skills[key];
}
