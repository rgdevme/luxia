import fs from "node:fs/promises";
import path from "node:path";
import type {
  AgentAdapter,
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
import { mirrorRules, removePaths, ruleMirrorPaths, writeIfChanged } from "../shared.js";

const GEMINI_RULES = "GEMINI.md";
const GEMINI_DIR = ".gemini";
const GEMINI_SETTINGS = path.join(GEMINI_DIR, "settings.json");

/**
 * Gemini CLI (Google's official terminal agent). Reads hierarchical `GEMINI.md`
 * context files and configures MCP servers under `mcpServers` in the shared
 * `.gemini/settings.json`. It has no lifecycle-hook or skills mechanism, so
 * those slices are intentionally absent.
 */
const geminiCli: AgentAdapter = {
  id: "gemini-cli",
  displayName: "Gemini CLI",
  paths: { rulesFilename: GEMINI_RULES, rulesRoot: "." },

  render: {
    async rules(state, ctx) {
      await mirrorRules(state as string[], GEMINI_RULES, ctx);
    },
    async mcp(state, ctx) {
      await writeGeminiMcp(state as ResolvedMcp[], ctx);
    },
  },

  scrape: {
    mcp: (ctx) => importGeminiMcp(ctx),
  },

  async claims(ctx) {
    const config = await readConfigOrDefault(ctx.configPath);
    const canonical = Object.keys(config.rules?.files ?? {});
    return [
      ...ruleMirrorPaths(canonical, GEMINI_RULES, ctx.projectRoot),
      path.join(ctx.projectRoot, GEMINI_SETTINGS),
    ];
  },
};

// ---------- mcp (.gemini/settings.json — shared file, mcpServers key only) ----------

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

async function writeGeminiMcp(servers: ResolvedMcp[], ctx: MaterializeContext): Promise<void> {
  const file = path.join(ctx.projectRoot, GEMINI_SETTINGS);
  const settings = await readSettings(file);
  if (settings === null) {
    ctx.logger.warn(`${GEMINI_SETTINGS} is not valid JSON; skipping mcp`);
    return;
  }
  if (servers.length > 0) {
    settings.data["mcpServers"] = Object.fromEntries(
      servers.map((m) => [m.name, toGeminiServer(m)]),
    );
  } else {
    // No servers declared → drop the key but keep any other settings intact.
    if (!settings.existed || !("mcpServers" in settings.data)) return;
    delete settings.data["mcpServers"];
  }
  const content = JSON.stringify(settings.data, null, 2) + "\n";
  await writeIfChanged(file, content, ctx, `${GEMINI_SETTINGS} (${servers.length} servers)`);
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
    const decl: McpDeclaration = {
      name,
      transport: httpUrl ? "http" : "sse",
      command: remote,
    };
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

export { removePaths };
export default geminiCli;
