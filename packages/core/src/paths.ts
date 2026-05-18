import path from "node:path";
import fs from "node:fs/promises";
import type { AgnosConfig } from "./types/public.js";

export const CONFIG_FILE = "agnos.json";
export const STATE_FILE = "state.json";
export const AGNOS_DIR = ".agnos";
export const DEFAULT_RULES_FILE = "AGENTS.md";
export const DEFAULT_SKILLS_DIR = path.join(AGNOS_DIR, "skills");

export interface ProjectPaths {
  projectRoot: string;
  configPath: string;
  agnosRoot: string;
  cacheDir: string;
  skillsDir: string;
  statePath: string;
}

export function buildPaths(projectRoot: string, config?: AgnosConfig): ProjectPaths {
  const agnosRoot = path.join(projectRoot, AGNOS_DIR);
  const skillsRel = config?.paths?.skillsDir ?? DEFAULT_SKILLS_DIR;
  return {
    projectRoot,
    configPath: path.join(projectRoot, CONFIG_FILE),
    agnosRoot,
    cacheDir: path.join(agnosRoot, "cache"),
    skillsDir: path.isAbsolute(skillsRel) ? skillsRel : path.join(projectRoot, skillsRel),
    statePath: path.join(agnosRoot, STATE_FILE),
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
