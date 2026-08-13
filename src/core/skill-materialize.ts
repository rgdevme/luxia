import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { copyRegularTree, type CopyTreeResult } from "./fs/copy-tree.js";

const SKILL_MARKER = "SKILL.md";

export interface MaterializeSkillResult extends CopyTreeResult {
  changed: boolean;
}

export async function materializeSkill(
  stored: string,
  destination: string,
  expectedHash: string,
  materializedHash?: string,
): Promise<MaterializeSkillResult> {
  if (materializedHash === expectedHash && (await isMaterializedSkill(destination))) {
    return { changed: false, methods: new Set() };
  }

  const parent = path.dirname(destination);
  const temporary = path.join(parent, `.tmp-${path.basename(destination)}-${randomUUID()}`);
  const previous = path.join(parent, `.old-${path.basename(destination)}-${randomUUID()}`);
  await fs.mkdir(parent, { recursive: true });

  try {
    const result = await copyRegularTree(stored, temporary, true);
    const existing = await fs.lstat(destination).catch(() => null);
    if (existing) await retryRename(destination, previous);
    try {
      await retryRename(temporary, destination);
    } catch (error) {
      if (existing) await retryRename(previous, destination).catch(() => undefined);
      throw error;
    }
    await fs
      .rm(previous, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
      .catch(() => undefined);
    return { changed: true, methods: result.methods };
  } finally {
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
}

async function retryRename(source: string, destination: string): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await fs.rename(source, destination);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const transient = code === "EACCES" || code === "EBUSY" || code === "EPERM";
      if (!transient || attempt === 7) throw error;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 25 * (attempt + 1));
      });
    }
  }
}

async function isMaterializedSkill(directory: string): Promise<boolean> {
  const stat = await fs.lstat(directory).catch(() => null);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) return false;
  return fs
    .access(path.join(directory, SKILL_MARKER))
    .then(() => true)
    .catch(() => false);
}
