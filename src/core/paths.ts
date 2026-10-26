import path from "node:path";
import fs from "node:fs/promises";
import type { AgnosConfig } from "./types/public.js";

export const CONFIG_FILE = "agnos.json";
export const AGNOS_DIR = ".agnos";
export const DEFAULT_RULES_FILE = "AGENTS.md";
export const DEFAULT_LOCAL_SKILLS_DIR = path.join(AGNOS_DIR, "skills");
export const DEFAULT_REFERENCES_DIR = path.join(AGNOS_DIR, "references");

export interface ProjectPaths {
  projectRoot: string;
  configPath: string;
  agnosRoot: string;
  localSkillsDir: string;
  referencesDir: string;
}

export function buildPaths(projectRoot: string, config?: AgnosConfig): ProjectPaths {
  const agnosRoot = path.join(projectRoot, AGNOS_DIR);
  const localSkillsRel = config?.skills?.dir ?? DEFAULT_LOCAL_SKILLS_DIR;
  return {
    projectRoot,
    configPath: path.join(projectRoot, CONFIG_FILE),
    agnosRoot,
    localSkillsDir: path.isAbsolute(localSkillsRel)
      ? localSkillsRel
      : path.join(projectRoot, localSkillsRel),
    referencesDir: path.resolve(projectRoot, config?.references?.dir ?? DEFAULT_REFERENCES_DIR),
  };
}

export async function findProjectRoot(start: string = process.cwd()): Promise<string> {
  let dir = path.resolve(start);
  while (true) {
    try {
      await fs.access(path.join(dir, CONFIG_FILE));
      return dir;
    } catch {
      // not here
    }
    try {
      await fs.access(path.join(dir, "package.json"));
      return dir;
    } catch {
      // not here either
    }
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start);
    dir = parent;
  }
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}
