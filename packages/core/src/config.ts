import fs from "node:fs/promises";
import type { AgnosConfig } from "./types/public.js";
import { agnosConfigSchema } from "./schema.js";

export const SCHEMA_URL = "https://unpkg.com/@luxia/core/schema.json";

export const DEFAULT_CONFIG: AgnosConfig = {
  $schema: SCHEMA_URL,
  agents: [],
  rules: { source: "./AGENTS.md" },
  skills: {},
  mcp: [],
};

export async function readConfig(configPath: string): Promise<AgnosConfig> {
  const raw = await fs.readFile(configPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`agnos.json is not valid JSON: ${(err as Error).message}`);
  }
  const result = agnosConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`agnos.json schema validation failed:\n${result.error.message}`);
  }
  return result.data as AgnosConfig;
}

export async function readConfigOrDefault(configPath: string): Promise<AgnosConfig> {
  try {
    return await readConfig(configPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(DEFAULT_CONFIG);
    throw err;
  }
}

export async function writeConfig(configPath: string, config: AgnosConfig): Promise<void> {
  const ordered = orderTopLevelKeys(config);
  const json = JSON.stringify(ordered, null, 2) + "\n";
  await fs.writeFile(configPath, json, "utf8");
}

export async function configExists(configPath: string): Promise<boolean> {
  try {
    await fs.access(configPath);
    return true;
  } catch {
    return false;
  }
}

const KEY_ORDER = ["$schema", "agents", "rules", "skills", "mcp", "hooks", "docs"];

function orderTopLevelKeys(config: AgnosConfig): AgnosConfig {
  const out: Record<string, unknown> = {};
  for (const key of KEY_ORDER) {
    if (key in config) out[key] = (config as Record<string, unknown>)[key];
  }
  for (const key of Object.keys(config)) {
    if (!(key in out)) out[key] = (config as Record<string, unknown>)[key];
  }
  return out as AgnosConfig;
}
