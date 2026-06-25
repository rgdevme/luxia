import fs from "node:fs/promises";
import path from "node:path";
import TOML from "@iarna/toml";
import type {
  AgentAdapter,
  HookEntry,
  HookEvent,
  MaterializeContext,
  McpDeclaration,
  ResolvedMcp,
} from "../../../core/index.js";
import { importMcpServers, pickEnv, pickStringArray } from "../../../core/index.js";
import { flattenHooks, groupHooks } from "../hooks-map.js";
import { linkSkills, mirrorRules, removePaths } from "../shared.js";

const CODEX_RULES = "AGENTS.md";
const CODEX_DIR = ".codex";
const CODEX_CONFIG = path.join(CODEX_DIR, "config.toml");
const CODEX_HOOKS = path.join(CODEX_DIR, "hooks.json");
const CODEX_SKILLS_DIR = path.join(".agents", "skills");

/** New-vocabulary events Codex understands (intersection with the closed set). */
const CODEX_EVENTS: ReadonlySet<HookEvent> = new Set<HookEvent>([
  "PreToolUse",
  "PostToolUse",
  "UserPromptSubmit",
  "PreCompact",
  "SubagentStop",
  "Stop",
  "SessionStart",
]);

const codex: AgentAdapter = {
  id: "codex",
  displayName: "OpenAI Codex",
  paths: { skillsDir: CODEX_SKILLS_DIR, rulesFilename: CODEX_RULES, rulesRoot: "." },

  render: {
    async rules(state, ctx) {
      // Codex reads AGENTS.md in place; mirrorRules no-ops when the canonical
      // basename already matches, so this only acts on differently-named canon.
      await mirrorRules(state as string[], CODEX_RULES, ctx);
    },
    async mcp(state, ctx) {
      await writeCodexConfig(state as ResolvedMcp[], ctx);
    },
    async hooks(state, ctx) {
      await writeCodexHooks(state as HookEntry[], ctx);
    },
    async skills(state, ctx) {
      await linkSkills(CODEX_SKILLS_DIR, state as string, ctx);
    },
  },

  scrape: {
    mcp: (ctx) => importCodexConfig(ctx),
    hooks: async (ctx) => flattenHooks(await readCodexHooks(ctx)),
    skills: () => Promise.resolve([]),
  },

  claims(ctx) {
    return [path.join(ctx.projectRoot, CODEX_DIR), path.join(ctx.projectRoot, CODEX_SKILLS_DIR)];
  },
};

// ---------- hooks (.codex/hooks.json) ----------

async function writeCodexHooks(entries: HookEntry[], ctx: MaterializeContext): Promise<void> {
  const file = path.join(ctx.projectRoot, CODEX_HOOKS);
  const { hooks, dropped } = groupHooks(entries, { events: CODEX_EVENTS, withMessage: false });
  if (dropped > 0) {
    ctx.logger.warn(
      `codex: skipped ${dropped} hook${dropped === 1 ? "" : "s"} for unsupported events`,
    );
  }
  if (Object.keys(hooks).length === 0) {
    if (!ctx.dryRun) await fs.rm(file, { force: true }).catch(() => {});
    return;
  }
  if (ctx.dryRun) {
    ctx.logger.info(`would: write ${CODEX_HOOKS} (${Object.keys(hooks).length} hook events)`);
    return;
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ hooks }, null, 2) + "\n", "utf8");
}

async function readCodexHooks(ctx: MaterializeContext): Promise<unknown> {
  const file = path.join(ctx.projectRoot, CODEX_HOOKS);
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    return {};
  }
  try {
    return (JSON.parse(raw) as { hooks?: unknown }).hooks ?? {};
  } catch {
    ctx.logger.warn(`${CODEX_HOOKS} is not valid JSON; skipping import`);
    return {};
  }
}

// ---------- mcp (.codex/config.toml) ----------

async function writeCodexConfig(servers: ResolvedMcp[], ctx: MaterializeContext): Promise<void> {
  const file = path.join(ctx.projectRoot, CODEX_CONFIG);
  // No servers declared → ensure the file is absent rather than writing an empty one.
  if (servers.length === 0) {
    if (ctx.dryRun) {
      ctx.logger.info(`would: remove ${CODEX_CONFIG} (no mcp servers)`);
      return;
    }
    await fs.rm(file, { force: true }).catch(() => {});
    return;
  }
  const tomlObj: Record<string, unknown> = {
    mcp_servers: Object.fromEntries(servers.map((m) => [m.name, toCodexServer(m)])),
  };
  if (ctx.dryRun) {
    ctx.logger.info(`would: write ${CODEX_CONFIG} (${servers.length} servers)`);
    return;
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, TOML.stringify(tomlObj as TOML.JsonMap), "utf8");
}

async function importCodexConfig(ctx: MaterializeContext): Promise<McpDeclaration[]> {
  return await importMcpServers(ctx, {
    relativePath: CODEX_CONFIG,
    format: "TOML",
    parse: (raw) => TOML.parse(raw),
    containerKey: "mcp_servers",
    fromEntry: fromCodexServer,
  });
}

function fromCodexServer(name: string, entry: unknown): McpDeclaration | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const e = entry as Record<string, unknown>;
  const rawTransport = typeof e["transport"] === "string" ? (e["transport"] as string) : undefined;
  const transport: "stdio" | "sse" | "http" =
    rawTransport === "sse" || rawTransport === "http" ? rawTransport : "stdio";
  const command = typeof e["command"] === "string" ? (e["command"] as string) : undefined;
  if (!command) return undefined;
  const decl: McpDeclaration = { name, transport, command };
  const args = pickStringArray(e["args"]);
  if (args && args.length > 0) decl.args = args;
  const env = pickEnv(e["env"]);
  if (env) decl.env = env;
  return decl;
}

function toCodexServer(decl: ResolvedMcp): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (decl.command) out["command"] = decl.command;
  if (decl.args) out["args"] = decl.args;
  if (decl.env) out["env"] = decl.env;
  if (decl.transport && decl.transport !== "stdio") out["transport"] = decl.transport;
  return out;
}

export { removePaths };
export default codex;
