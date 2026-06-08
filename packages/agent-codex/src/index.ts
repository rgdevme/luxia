import fs from "node:fs/promises";
import path from "node:path";
import TOML from "@iarna/toml";
import type { AgentPlugin, MaterializeContext, McpDeclaration, ResolvedMcp } from "@luxia/core";
import {
  type AgentRuleTarget,
  materializeRuleMirrors,
  pruneRuleMirrors,
  readConfigOrDefault,
  resolveRules,
} from "@luxia/core";

const ROOT_AGENTS = "AGENTS.md";
const CODEX_DIR = ".codex";
const CODEX_CONFIG = path.join(CODEX_DIR, "config.toml");
const CODEX_SKILLS_DIR = path.join(".agents", "skills");
const RULES_TARGET: AgentRuleTarget = { agentRoot: ".", agentFilename: ROOT_AGENTS };

const codex: AgentPlugin = {
  id: "codex",
  displayName: "OpenAI Codex",

  // Declarative: the skills domain links this directory to `.agnos/skills/`.
  // Codex picks up skills under `.agents/skills/<name>/` automatically.
  paths: {
    skillsDir: CODEX_SKILLS_DIR,
    rulesFilename: ROOT_AGENTS,
    rulesRoot: ".",
  },

  handles: {
    rules: {
      // Codex reads AGENTS.md walking up the tree. When the canonical filename
      // and root match (root="."), every entry is in place and no symlink is
      // created; otherwise a sibling AGENTS.md mirror points at the canonical.
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
      async onInitialize(state, ctx) {
        await writeCodexConfig(state, ctx);
      },
      async onImport(ctx) {
        return await importCodexConfig(ctx);
      },
      async onCleanup(ctx) {
        await fs
          .rm(path.join(ctx.projectRoot, CODEX_DIR), { recursive: true, force: true })
          .catch(() => {});
        ctx.logger.info("Codex artifacts removed");
      },
    },
  },
};

// ---------- helpers ----------

async function writeCodexConfig(servers: ResolvedMcp[], ctx: MaterializeContext): Promise<void> {
  const tomlObj: Record<string, unknown> = {
    mcp_servers: Object.fromEntries(servers.map((m) => [m.name, toCodexServer(m)])),
  };
  const file = path.join(ctx.projectRoot, CODEX_CONFIG);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const content = TOML.stringify(tomlObj as TOML.JsonMap);
  await fs.writeFile(file, content, "utf8");
  ctx.logger.info(
    `.codex/config.toml (${servers.length} server${servers.length === 1 ? "" : "s"})`,
  );
}

async function importCodexConfig(ctx: MaterializeContext): Promise<McpDeclaration[]> {
  const file = path.join(ctx.projectRoot, CODEX_CONFIG);
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    ctx.logger.warn(`could not read ${CODEX_CONFIG}: ${(err as Error).message}`);
    return [];
  }
  let parsed: unknown;
  try {
    parsed = TOML.parse(raw);
  } catch {
    ctx.logger.warn(`${CODEX_CONFIG} is not valid TOML; skipping import`);
    return [];
  }
  const servers = (parsed as { mcp_servers?: unknown })?.mcp_servers;
  if (!servers || typeof servers !== "object") return [];
  const out: McpDeclaration[] = [];
  for (const [name, entry] of Object.entries(servers as Record<string, unknown>)) {
    const decl = fromCodexServer(name, entry);
    if (decl) out.push(decl);
  }
  return out;
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

function toCodexServer(decl: ResolvedMcp): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (decl.command) out["command"] = decl.command;
  if (decl.args) out["args"] = decl.args;
  if (decl.env) out["env"] = decl.env;
  if (decl.transport && decl.transport !== "stdio") out["transport"] = decl.transport;
  return out;
}

export default codex;
