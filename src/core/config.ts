import fs from "node:fs/promises";
import type { AgnosConfig } from "./types/public.js";
import { agnosConfigSchema, SCHEMA_VERSION } from "./schema.js";

export const SCHEMA_URL = "https://unpkg.com/@luxia/agnos/schema.json";

export const DEFAULT_CONFIG: AgnosConfig = {
  $schema: SCHEMA_URL,
  schemaVersion: SCHEMA_VERSION,
  harness: [],
  rules: { fragments: {} },
  skills: {},
  references: { dir: ".agnos/references", sources: {} },
  mcp: { servers: [] },
};

export async function readConfig(configPath: string): Promise<AgnosConfig> {
  const raw = await fs.readFile(configPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`agnos.json is not valid JSON: ${(err as Error).message}`);
  }
  // A pre-v1 config (no `schemaVersion`, or a different one) is from the old
  // schema. Reject with a clear remediation rather than a noisy zod dump.
  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as Record<string, unknown>)["schemaVersion"] !== SCHEMA_VERSION
  ) {
    throw new Error(
      `agnos.json is missing "schemaVersion": ${SCHEMA_VERSION} (or uses an older schema). ` +
        `The agnos.json format changed in v0.1 — re-run \`agnos --init\` to regenerate it.`,
    );
  }
  const legacyKeys = parsed as Record<string, unknown>;
  if ("agents" in legacyKeys) {
    throw new Error('agnos.json uses the renamed "agents" key; rename it to "harness"');
  }
  if ("hooks" in legacyKeys) {
    throw new Error('hooks are no longer managed by Agnos; remove "hooks" from agnos.json');
  }
  const result = agnosConfigSchema.safeParse(parsed);
  if (!result.success) {
    const skillSources =
      parsed && typeof parsed === "object"
        ? (parsed as { skills?: { sources?: unknown } }).skills?.sources
        : undefined;
    if (
      skillSources &&
      typeof skillSources === "object" &&
      Object.values(skillSources).some((source) => typeof source === "string")
    ) {
      throw new Error(
        `agnos.json still uses legacy composite skill sources. Run \`agnos --init\` to migrate them to normalized requests.`,
      );
    }
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

const KEY_ORDER = [
  "$schema",
  "schemaVersion",
  "harness",
  "rules",
  "skills",
  "references",
  "mcp",
  "docs",
];

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
