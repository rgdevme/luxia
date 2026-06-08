import fs from "node:fs/promises";
import path from "node:path";
import type { AgentPlugin, MaterializeContext, McpDeclaration, ResolvedMcp } from "@luxia/core";
import {
  type AgentRuleTarget,
  materializeRuleMirrors,
  pruneRuleMirrors,
  readConfigOrDefault,
  resolveRules,
} from "@luxia/core";

const CLAUDE_RULES = "CLAUDE.md";
const CLAUDE_MCP = ".mcp.json";
const CLAUDE_SKILLS_DIR = path.join(".claude", "skills");
const RULES_TARGET: AgentRuleTarget = { agentRoot: ".", agentFilename: CLAUDE_RULES };

const claudeCode: AgentPlugin = {
  id: "claude-code",
  displayName: "Claude Code",

  // Declarative: the skills domain links this directory to `.agnos/skills/`.
  // No per-skill handlers needed — Claude Code reads `.claude/skills/<name>/`
  // and that directory IS the canonical skills storage after bootstrap.
  paths: {
    skillsDir: CLAUDE_SKILLS_DIR,
    rulesFilename: CLAUDE_RULES,
    rulesRoot: ".",
  },

  handles: {
    rules: {
      // Mirror every canonical rule file as a sibling `CLAUDE.md`. Receives the
      // full resolved set, so add/move/remove all flow through here.
      async onInitialize(state, ctx) {
        await materializeRuleMirrors(state, RULES_TARGET, ctx);
      },
      async onCleanup(ctx) {
        const config = await readConfigOrDefault(ctx.configPath);
        if (!config.rules) return;
        await pruneRuleMirrors(resolveRules(config.rules, ctx), RULES_TARGET, ctx);
      },
    },
    mcp: {
      // Same single-file regeneration story; onAdded/onUpdated/onRemoved fall
      // back to onInitialize with the full mcp[] state.
      async onInitialize(state, ctx) {
        await writeMcpFile(state, ctx);
      },
      async onImport(ctx) {
        return await importMcpFile(ctx);
      },
      async onCleanup(ctx) {
        await removeMcpFile(ctx);
      },
    },
  },
};

// ---------- single-write helpers ----------

async function writeMcpFile(servers: ResolvedMcp[], ctx: MaterializeContext): Promise<void> {
  const out = {
    mcpServers: Object.fromEntries(servers.map((m) => [m.name, toClaudeServer(m)])),
  };
  const file = path.join(ctx.projectRoot, CLAUDE_MCP);
  await fs.writeFile(file, JSON.stringify(out, null, 2) + "\n", "utf8");
  ctx.logger.info(`.mcp.json (${servers.length} server${servers.length === 1 ? "" : "s"})`);
}

async function removeMcpFile(ctx: MaterializeContext): Promise<void> {
  try {
    await ctx.linker.unlink(path.join(ctx.projectRoot, CLAUDE_MCP));
  } catch {
    // ignore
  }
}

async function importMcpFile(ctx: MaterializeContext): Promise<McpDeclaration[]> {
  const file = path.join(ctx.projectRoot, CLAUDE_MCP);
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    ctx.logger.warn(`could not read ${CLAUDE_MCP}: ${(err as Error).message}`);
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    ctx.logger.warn(`${CLAUDE_MCP} is not valid JSON; skipping import`);
    return [];
  }
  const servers = (parsed as { mcpServers?: unknown })?.mcpServers;
  if (!servers || typeof servers !== "object") return [];
  const out: McpDeclaration[] = [];
  for (const [name, entry] of Object.entries(servers as Record<string, unknown>)) {
    const decl = fromClaudeServer(name, entry);
    if (decl) out.push(decl);
  }
  return out;
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

function pickStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((x): x is string => typeof x === "string");
  return out.length === value.length ? out : undefined;
}

function pickEnv(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function toClaudeServer(decl: ResolvedMcp): Record<string, unknown> {
  if (decl.transport && decl.transport !== "stdio") {
    return {
      type: decl.transport,
      url: decl.command,
      ...(decl.env ? { env: decl.env } : {}),
    };
  }
  return {
    command: decl.command ?? "",
    ...(decl.args ? { args: decl.args } : {}),
    ...(decl.env ? { env: decl.env } : {}),
  };
}

export default claudeCode;
