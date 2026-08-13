import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { copyRegularTree } from "./fs/copy-tree.js";
import { hashSkillDir } from "./skill-hash.js";

const SKILL_MARKER = "SKILL.md";
const storeWrites = new Map<string, Promise<string>>();
const PUBLISH_RETRIES = 8;
const RETRY_DELAY_MS = 25;

export function resolveStoredSkill(storeDir: string, hash: string): string {
  return path.join(storeDir, "skills", hash);
}

export async function findStoredSkill(storeDir: string, hash: string): Promise<string | null> {
  const stored = resolveStoredSkill(storeDir, hash);
  return (await isStoredSkillValid(stored, hash)) ? stored : null;
}

export async function ensureStoredSkill(
  source: string,
  storeDir: string,
  hash: string,
): Promise<string> {
  const stored = resolveStoredSkill(storeDir, hash);
  if (path.resolve(source) === path.resolve(stored)) return stored;

  const pending = storeWrites.get(stored);
  if (pending) return pending;

  const write = populateStoredSkill(source, stored);
  storeWrites.set(stored, write);
  try {
    return await write;
  } finally {
    if (storeWrites.get(stored) === write) storeWrites.delete(stored);
  }
}

async function populateStoredSkill(source: string, stored: string): Promise<string> {
  if (await isStoredSkillValid(stored, path.basename(stored))) return stored;

  const parent = path.dirname(stored);
  const temporary = path.join(parent, `.tmp-${path.basename(stored)}-${randomUUID()}`);
  await fs.mkdir(parent, { recursive: true });

  try {
    await retryTransient(async () => {
      await copyRegularTree(source, temporary);
    });
    const expectedHash = path.basename(stored);
    if ((await hashSkillDir(temporary)) !== expectedHash) {
      throw new Error(`source content does not match expected hash ${expectedHash}`);
    }
    return await publishStoredSkill(temporary, stored, expectedHash);
  } catch (error) {
    throw new Error(`failed to populate skill store at ${stored}: ${formatError(error)}`, {
      cause: error,
    });
  } finally {
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
}

async function publishStoredSkill(
  temporary: string,
  stored: string,
  expectedHash: string,
): Promise<string> {
  for (let attempt = 0; attempt < PUBLISH_RETRIES; attempt += 1) {
    try {
      await fs.rename(temporary, stored);
      return stored;
    } catch (error) {
      if (await isStoredSkillValid(stored, expectedHash)) return stored;
      await quarantineInvalidStoreEntry(stored);
      if (!isTransient(error) || attempt === PUBLISH_RETRIES - 1) throw error;
      await wait(RETRY_DELAY_MS * (attempt + 1));
    }
  }
  throw new Error(`could not publish ${stored}`);
}

async function retryTransient(operation: () => Promise<void>): Promise<void> {
  for (let attempt = 0; attempt < PUBLISH_RETRIES; attempt += 1) {
    try {
      await operation();
      return;
    } catch (error) {
      if (!isTransient(error) || attempt === PUBLISH_RETRIES - 1) throw error;
      await wait(RETRY_DELAY_MS * (attempt + 1));
    }
  }
}

function isTransient(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return (
    code === "EACCES" ||
    code === "EBUSY" ||
    code === "EEXIST" ||
    code === "ENOTEMPTY" ||
    code === "EPERM"
  );
}

function formatError(error: unknown): string {
  const code = (error as NodeJS.ErrnoException).code;
  const message = error instanceof Error ? error.message : String(error);
  return code ? `${code}: ${message}` : message;
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function isSkillDir(directory: string): Promise<boolean> {
  try {
    const stat = await fs.stat(directory);
    if (!stat.isDirectory()) return false;
    await fs.access(path.join(directory, SKILL_MARKER));
    return true;
  } catch {
    return false;
  }
}

async function isStoredSkillValid(directory: string, expectedHash: string): Promise<boolean> {
  if (!(await isSkillDir(directory))) return false;
  return (await hashSkillDir(directory).catch(() => null)) === expectedHash;
}

async function quarantineInvalidStoreEntry(directory: string): Promise<void> {
  const stat = await fs.lstat(directory).catch(() => null);
  if (!stat) return;
  const quarantine = `${directory}.invalid-${randomUUID()}`;
  try {
    await fs.rename(directory, quarantine);
    await fs.rm(quarantine, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
