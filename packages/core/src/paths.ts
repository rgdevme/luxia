import path from "node:path";
import fs from "node:fs/promises";

export const CONFIG_FILE = "agnos.json";
export const AGNOS_DIR = ".agnos";
export const DEFAULT_RULES_FILE = "AGENTS.md";

export interface ProjectPaths {
  projectRoot: string;
  configPath: string;
  agnosRoot: string;
  cacheDir: string;
  skillsDir: string;
}

export function buildPaths(projectRoot: string): ProjectPaths {
  const agnosRoot = path.join(projectRoot, AGNOS_DIR);
  return {
    projectRoot,
    configPath: path.join(projectRoot, CONFIG_FILE),
    agnosRoot,
    cacheDir: path.join(agnosRoot, "cache"),
    skillsDir: path.join(agnosRoot, "skills"),
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
