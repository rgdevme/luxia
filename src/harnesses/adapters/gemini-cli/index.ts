import fs from "node:fs/promises";
import path from "node:path";
import type {
  HarnessAdapter,
  MaterializeContext,
  McpDeclaration,
  ResolvedMcp,
  SkillMetadataDiagnostic,
  SkillMetadataValidationInput,
} from "../../../core/index.js";
import { validateRequiredSkillFields } from "../../../core/skill-metadata.js";
import {
  importMcpServers,
  pickEnv,
  pickEnvKeys,
  pickStringArray,
  readConfigOrDefault,
} from "../../../core/index.js";
import {
  linkSkills,
  mirrorRules,
  removePaths,
  ruleMirrorPaths,
  writeIfChanged,
} from "../shared.js";

const GEMINI_RULES = "GEMINI.md";
const GEMINI_DIR = ".gemini";
const GEMINI_SETTINGS = path.join(GEMINI_DIR, "settings.json");
const GEMINI_SKILLS_DIR = path.join(GEMINI_DIR, "skills");

/**
 * Gemini CLI (Google's official terminal agent). Reads hierarchical `GEMINI.md`
 * context files; MCP servers live in the shared
 * `.gemini/settings.json`, and skills are self-contained directories under
 * `.gemini/skills/`.
 */
const geminiCli: HarnessAdapter = {
  id: "gemini-cli",
  displayName: "Gemini CLI",
  paths: { skillsDir: GEMINI_SKILLS_DIR, rulesFilename: GEMINI_RULES, rulesRoot: "." },
  validateSkillMetadata(input: SkillMetadataValidationInput): SkillMetadataDiagnostic[] {
    return validateRequiredSkillFields(this.id, input.name, input.directory, input.frontmatter, [
      "name",
      "description",
    ]);
  },

  render: {
    async rules(state, ctx) {
      await mirrorRules(state as string[], GEMINI_RULES, ctx);
    },
    async mcp(state, ctx) {
      await writeGeminiMcp(state as ResolvedMcp[], ctx);
    },
    async skills(state, ctx) {
      await linkSkills(GEMINI_SKILLS_DIR, state as Record<string, string>, ctx);
    },
  },

  scrape: {
    mcp: (ctx) => importGeminiMcp(ctx),
    skills: (ctx) => listSkillDirs(ctx),
  },

  async claims(ctx) {
    const config = await readConfigOrDefault(ctx.configPath);
    const canonical = Object.keys(config.rules?.fragments ?? {});
    // `.gemini/settings.json` is a shared user file (holds theme, etc.), so it is
    // deliberately not claimed — cleanup empties its keys via render, not deletion.
    return [
      ...ruleMirrorPaths(canonical, GEMINI_RULES, ctx.projectRoot),
      path.join(ctx.projectRoot, GEMINI_SKILLS_DIR),
    ];
  },
};

// ---------- shared settings.json ----------

interface LoadedSettings {
  data: Record<string, unknown>;
  existed: boolean;
}

async function readSettings(file: string): Promise<LoadedSettings | null> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { data: {}, existed: false };
    throw err;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { data: {}, existed: true };
    }
    return { data: parsed as Record<string, unknown>, existed: true };
  } catch {
    return null;
  }
}

/**
 * Set (or delete, when `value` is undefined) a single top-level key in the
 * shared settings file, preserving every other key. Absent + nothing-to-do is a
 * no-op when the key is already absent.
 */
async function updateSettingsKey(
  key: string,
  value: unknown,
  ctx: MaterializeContext,
  label: string,
): Promise<void> {
  const file = path.join(ctx.projectRoot, GEMINI_SETTINGS);
  const settings = await readSettings(file);
  if (settings === null) {
    ctx.logger.warn(`${GEMINI_SETTINGS} is not valid JSON; skipping ${key}`);
    return;
  }
  if (value !== undefined) {
    settings.data[key] = value;
  } else {
    if (!settings.existed || !(key in settings.data)) return;
    const { [key]: _dropped, ...rest } = settings.data;
    settings.data = rest;
  }
  const content = JSON.stringify(settings.data, null, 2) + "\n";
  await writeIfChanged(file, content, ctx, label);
}

// ---------- mcp ----------

async function writeGeminiMcp(servers: ResolvedMcp[], ctx: MaterializeContext): Promise<void> {
  // `command` carries the executable (stdio) or the remote URL (http/sse); an
  // entry without it can't produce valid Gemini config, so skip it with a warning.
  const usable = servers.filter((m) => {
    if (m.command) return true;
    ctx.logger.warn(`gemini-cli: skipping mcp server "${m.name}" (no command/url)`);
    return false;
  });
  const value =
    usable.length > 0
      ? Object.fromEntries(usable.map((m) => [m.name, toGeminiServer(m)]))
      : undefined;
  await updateSettingsKey(
    "mcpServers",
    value,
    ctx,
    `${GEMINI_SETTINGS} (${usable.length} servers)`,
  );
}

async function importGeminiMcp(ctx: MaterializeContext): Promise<McpDeclaration[]> {
  return await importMcpServers(ctx, {
    relativePath: GEMINI_SETTINGS,
    format: "JSON",
    parse: (raw) => JSON.parse(raw),
    containerKey: "mcpServers",
    fromEntry: fromGeminiServer,
  });
}

function fromGeminiServer(name: string, entry: unknown): McpDeclaration | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const e = entry as Record<string, unknown>;
  // HTTP streaming: `httpUrl`; SSE: `url`. Gemini keys the transport by field.
  const httpUrl = typeof e["httpUrl"] === "string" ? (e["httpUrl"] as string) : undefined;
  const url = typeof e["url"] === "string" ? (e["url"] as string) : undefined;
  const remote = httpUrl ?? url;
  if (remote) {
    const decl: McpDeclaration = { name, transport: httpUrl ? "http" : "sse", command: remote };
    const env = pickEnvKeys(e["env"]);
    if (env) decl.env = env;
    const headers = pickEnv(e["headers"]);
    if (headers) decl.headers = headers;
    return decl;
  }
  const command = typeof e["command"] === "string" ? (e["command"] as string) : undefined;
  if (!command) return undefined;
  const decl: McpDeclaration = { name, transport: "stdio", command };
  const args = pickStringArray(e["args"]);
  if (args && args.length > 0) decl.args = args;
  const env = pickEnvKeys(e["env"]);
  if (env) decl.env = env;
  return decl;
}

// Callers guarantee `decl.command` is set (writeGeminiMcp filters); each field
// is still guarded so a stray empty value never lands in the config.
function toGeminiServer(decl: ResolvedMcp): Record<string, unknown> {
  if (decl.transport === "http") {
    return {
      ...(decl.command ? { httpUrl: decl.command } : {}),
      ...(decl.headers ? { headers: decl.headers } : {}),
      ...(decl.env ? { env: decl.env } : {}),
    };
  }
  if (decl.transport === "sse") {
    return {
      ...(decl.command ? { url: decl.command } : {}),
      ...(decl.headers ? { headers: decl.headers } : {}),
      ...(decl.env ? { env: decl.env } : {}),
    };
  }
  return {
    ...(decl.command ? { command: decl.command } : {}),
    ...(decl.args ? { args: decl.args } : {}),
    ...(decl.env ? { env: decl.env } : {}),
  };
}

// ---------- skills (scrape) ----------

async function listSkillDirs(ctx: MaterializeContext): Promise<string[]> {
  const dir = path.join(ctx.projectRoot, GEMINI_SKILLS_DIR);
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() || e.isSymbolicLink()).map((e) => e.name);
  } catch {
    return [];
  }
}

export { removePaths };
export default geminiCli;
