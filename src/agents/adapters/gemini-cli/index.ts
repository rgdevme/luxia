import fs from "node:fs/promises";
import path from "node:path";
import type {
  AgentAdapter,
  HookEntry,
  HookEvent,
  MaterializeContext,
  McpDeclaration,
  ResolvedMcp,
} from "../../../core/index.js";
import {
  importMcpServers,
  pickEnv,
  pickStringArray,
  readConfigOrDefault,
} from "../../../core/index.js";
import { flattenHooks, groupHooks } from "../hooks-map.js";
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
 * Gemini names hook events differently from agnos' closed vocabulary. Only the
 * events with a faithful semantic counterpart are translated; the rest (e.g.
 * `SubagentStop`, or Gemini's `BeforeModel`) are dropped on render/scrape.
 */
const AGNOS_TO_GEMINI_EVENT: Partial<Record<HookEvent, string>> = {
  PreToolUse: "BeforeTool",
  PostToolUse: "AfterTool",
  UserPromptSubmit: "BeforeAgent",
  Stop: "AfterAgent",
  PreCompact: "PreCompress",
  Notification: "Notification",
  SessionStart: "SessionStart",
  SessionEnd: "SessionEnd",
};

const GEMINI_TO_AGNOS_EVENT: Record<string, HookEvent> = Object.fromEntries(
  Object.entries(AGNOS_TO_GEMINI_EVENT).map(([agnos, gemini]) => [gemini, agnos as HookEvent]),
);

const GEMINI_HOOK_EVENTS: ReadonlySet<HookEvent> = new Set(
  Object.keys(AGNOS_TO_GEMINI_EVENT) as HookEvent[],
);

/**
 * Gemini CLI (Google's official terminal agent). Reads hierarchical `GEMINI.md`
 * context files; MCP servers and lifecycle hooks both live in the shared
 * `.gemini/settings.json`, and skills are self-contained directories under
 * `.gemini/skills/`.
 */
const geminiCli: AgentAdapter = {
  id: "gemini-cli",
  displayName: "Gemini CLI",
  paths: { skillsDir: GEMINI_SKILLS_DIR, rulesFilename: GEMINI_RULES, rulesRoot: "." },

  render: {
    async rules(state, ctx) {
      await mirrorRules(state as string[], GEMINI_RULES, ctx);
    },
    async mcp(state, ctx) {
      await writeGeminiMcp(state as ResolvedMcp[], ctx);
    },
    async hooks(state, ctx) {
      await writeGeminiHooks(state as HookEntry[], ctx);
    },
    async skills(state, ctx) {
      await linkSkills(GEMINI_SKILLS_DIR, state as string, ctx);
    },
  },

  scrape: {
    mcp: (ctx) => importGeminiMcp(ctx),
    hooks: async (ctx) => importGeminiHooks(ctx),
    skills: (ctx) => listSkillDirs(ctx),
  },

  async claims(ctx) {
    const config = await readConfigOrDefault(ctx.configPath);
    const canonical = Object.keys(config.rules?.files ?? {});
    // `.gemini/settings.json` is a shared user file (holds theme, etc.), so it is
    // deliberately not claimed — cleanup empties its keys via render, not deletion.
    return [
      ...ruleMirrorPaths(canonical, GEMINI_RULES, ctx.projectRoot),
      path.join(ctx.projectRoot, GEMINI_SKILLS_DIR),
    ];
  },
};

// ---------- shared settings.json (mcp + hooks live in the same file) ----------

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
 * no-op, so mcp and hooks compose cleanly on the same file.
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

/** Rename an event-keyed record through a name map, dropping unmapped keys. */
function renameEventKeys(
  native: Record<string, unknown>,
  map: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [event, groups] of Object.entries(native)) {
    const mapped = map[event];
    if (mapped) out[mapped] = groups;
  }
  return out;
}

// ---------- mcp ----------

async function writeGeminiMcp(servers: ResolvedMcp[], ctx: MaterializeContext): Promise<void> {
  const value =
    servers.length > 0
      ? Object.fromEntries(servers.map((m) => [m.name, toGeminiServer(m)]))
      : undefined;
  await updateSettingsKey(
    "mcpServers",
    value,
    ctx,
    `${GEMINI_SETTINGS} (${servers.length} servers)`,
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
    const env = pickEnv(e["env"]);
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
  const env = pickEnv(e["env"]);
  if (env) decl.env = env;
  return decl;
}

function toGeminiServer(decl: ResolvedMcp): Record<string, unknown> {
  if (decl.transport === "http") {
    return {
      httpUrl: decl.command ?? "",
      ...(decl.headers ? { headers: decl.headers } : {}),
      ...(decl.env ? { env: decl.env } : {}),
    };
  }
  if (decl.transport === "sse") {
    return {
      url: decl.command ?? "",
      ...(decl.headers ? { headers: decl.headers } : {}),
      ...(decl.env ? { env: decl.env } : {}),
    };
  }
  return {
    command: decl.command ?? "",
    ...(decl.args ? { args: decl.args } : {}),
    ...(decl.env ? { env: decl.env } : {}),
  };
}

// ---------- hooks (.gemini/settings.json#hooks, Gemini event vocabulary) ----------

async function writeGeminiHooks(entries: HookEntry[], ctx: MaterializeContext): Promise<void> {
  // Gemini handlers carry no user-facing status text, so drop `message`.
  const { hooks, dropped } = groupHooks(entries, {
    events: GEMINI_HOOK_EVENTS,
    withMessage: false,
  });
  if (dropped > 0) {
    ctx.logger.warn(
      `gemini-cli: skipped ${dropped} hook${dropped === 1 ? "" : "s"} for unsupported events`,
    );
  }
  const renamed = renameEventKeys(hooks, AGNOS_TO_GEMINI_EVENT as Record<string, string>);
  const value = Object.keys(renamed).length > 0 ? renamed : undefined;
  await updateSettingsKey(
    "hooks",
    value,
    ctx,
    `${GEMINI_SETTINGS} (${Object.keys(renamed).length} hook events)`,
  );
}

async function importGeminiHooks(ctx: MaterializeContext): Promise<HookEntry[]> {
  const file = path.join(ctx.projectRoot, GEMINI_SETTINGS);
  const settings = await readSettings(file);
  if (settings === null) {
    ctx.logger.warn(`${GEMINI_SETTINGS} is not valid JSON; skipping hooks import`);
    return [];
  }
  const native = settings.data["hooks"];
  if (!native || typeof native !== "object" || Array.isArray(native)) return [];
  const renamed = renameEventKeys(native as Record<string, unknown>, GEMINI_TO_AGNOS_EVENT);
  return flattenHooks(renamed);
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
