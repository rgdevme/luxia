import fs from "node:fs/promises";
import path from "node:path";
import type {
  AgentAdapter,
  HookEntry,
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

const CLAUDE_RULES = "CLAUDE.md";
const CLAUDE_MCP = ".mcp.json";
const CLAUDE_SETTINGS = path.join(".claude", "settings.json");
const CLAUDE_SKILLS_DIR = path.join(".claude", "skills");

const claudeCode: AgentAdapter = {
  id: "claude-code",
  displayName: "Claude Code",
  paths: { skillsDir: CLAUDE_SKILLS_DIR, rulesFilename: CLAUDE_RULES, rulesRoot: "." },

  render: {
    async rules(state, ctx) {
      await mirrorRules(state as string[], CLAUDE_RULES, ctx);
    },
    async mcp(state, ctx) {
      await writeMcpFile(state as ResolvedMcp[], ctx);
    },
    async hooks(state, ctx) {
      await writeClaudeHooks(state as HookEntry[], ctx);
    },
    async skills(state, ctx) {
      await linkSkills(CLAUDE_SKILLS_DIR, state as string, ctx);
    },
  },

  scrape: {
    mcp: (ctx) => importMcpFile(ctx),
    hooks: async (ctx) => flattenHooks((await readSettings(settingsPath(ctx)))?.data["hooks"]),
    skills: (ctx) => listSkillDirs(ctx),
  },

  async claims(ctx) {
    const config = await readConfigOrDefault(ctx.configPath);
    const canonical = Object.keys(config.rules?.files ?? {});
    return [
      ...ruleMirrorPaths(canonical, CLAUDE_RULES, ctx.projectRoot),
      path.join(ctx.projectRoot, CLAUDE_MCP),
      path.join(ctx.projectRoot, CLAUDE_SKILLS_DIR),
    ];
  },
};

// ---------- hooks (.claude/settings.json — shared file, hooks key only) ----------

interface LoadedSettings {
  data: Record<string, unknown>;
  existed: boolean;
}

function settingsPath(ctx: MaterializeContext): string {
  return path.join(ctx.projectRoot, CLAUDE_SETTINGS);
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

async function writeClaudeHooks(entries: HookEntry[], ctx: MaterializeContext): Promise<void> {
  const file = settingsPath(ctx);
  const settings = await readSettings(file);
  if (settings === null) {
    ctx.logger.warn(`${CLAUDE_SETTINGS} is not valid JSON; skipping hooks`);
    return;
  }
  const { hooks } = groupHooks(entries, { withMessage: true });
  const hasHooks = Object.keys(hooks).length > 0;
  if (hasHooks) {
    settings.data["hooks"] = hooks;
  } else {
    if (!settings.existed || !("hooks" in settings.data)) return;
    delete settings.data["hooks"];
  }
  const content = JSON.stringify(settings.data, null, 2) + "\n";
  await writeIfChanged(
    file,
    content,
    ctx,
    `${CLAUDE_SETTINGS} (${Object.keys(hooks).length} hook events)`,
  );
}

// ---------- mcp (.mcp.json) ----------

async function writeMcpFile(servers: ResolvedMcp[], ctx: MaterializeContext): Promise<void> {
  const file = path.join(ctx.projectRoot, CLAUDE_MCP);
  // No servers declared → ensure the file is absent rather than writing an empty one.
  if (servers.length === 0) {
    if (ctx.dryRun) {
      ctx.logger.info(`would: remove ${CLAUDE_MCP} (no mcp servers)`);
      return;
    }
    await fs.rm(file, { force: true }).catch(() => {});
    return;
  }
  const out = { mcpServers: Object.fromEntries(servers.map((m) => [m.name, toClaudeServer(m)])) };
  const content = JSON.stringify(out, null, 2) + "\n";
  await writeIfChanged(file, content, ctx, `${CLAUDE_MCP} (${servers.length} servers)`);
}

async function importMcpFile(ctx: MaterializeContext): Promise<McpDeclaration[]> {
  return await importMcpServers(ctx, {
    relativePath: CLAUDE_MCP,
    format: "JSON",
    parse: (raw) => JSON.parse(raw),
    containerKey: "mcpServers",
    fromEntry: fromClaudeServer,
  });
}

function fromClaudeServer(name: string, entry: unknown): McpDeclaration | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const e = entry as Record<string, unknown>;
  const type = typeof e["type"] === "string" ? (e["type"] as string) : undefined;
  if (type === "sse" || type === "http") {
    const url = typeof e["url"] === "string" ? (e["url"] as string) : undefined;
    if (!url) return undefined;
    const decl: McpDeclaration = { name, transport: type, command: url };
    const env = pickEnv(e["env"]);
    if (env) decl.env = env;
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

function toClaudeServer(decl: ResolvedMcp): Record<string, unknown> {
  if (decl.transport && decl.transport !== "stdio") {
    return { type: decl.transport, url: decl.command, ...(decl.env ? { env: decl.env } : {}) };
  }
  return {
    command: decl.command ?? "",
    ...(decl.args ? { args: decl.args } : {}),
    ...(decl.env ? { env: decl.env } : {}),
  };
}

// ---------- skills (scrape) ----------

async function listSkillDirs(ctx: MaterializeContext): Promise<string[]> {
  const dir = path.join(ctx.projectRoot, CLAUDE_SKILLS_DIR);
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() || e.isSymbolicLink()).map((e) => e.name);
  } catch {
    return [];
  }
}

export { removePaths };
export default claudeCode;
