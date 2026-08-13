import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
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
  const temporary = `${p}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, json, "utf8");
    await publishLock(temporary, p, json);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

async function publishLock(
  temporary: string,
  destination: string,
  contents: string,
): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await fs.rename(temporary, destination);
      return;
    } catch (error) {
      const current = await fs.readFile(destination, "utf8").catch(() => null);
      if (current === contents) return;
      if (!isTransient(error) || attempt === 7) {
        throw new Error(`failed to publish ${LOCK_FILE}: ${(error as Error).message}`, {
          cause: error,
        });
      }
      await wait(25 * (attempt + 1));
    }
  }
}

function isTransient(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EACCES" || code === "EBUSY" || code === "EEXIST" || code === "EPERM";
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
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
