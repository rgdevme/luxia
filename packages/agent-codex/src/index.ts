import fs from "node:fs/promises";
import path from "node:path";
import TOML from "@iarna/toml";
import type {
  AgentPlugin,
  HookMatcherGroup,
  HooksDeclaration,
  MaterializeContext,
  McpDeclaration,
  ResolvedMcp,
  ResolvedRule,
} from "@luxia/core";

const ROOT_AGENTS = "AGENTS.md";
const CODEX_DIR = ".codex";
const CODEX_CONFIG = path.join(CODEX_DIR, "config.toml");
const CODEX_HOOKS = path.join(CODEX_DIR, "hooks.json");
const CODEX_SKILLS_DIR = path.join(".agents", "skills");

/** Hook events Codex understands; everything else is dropped on materialize. */
const CODEX_HOOK_EVENTS = new Set([
  "SessionStart",
  "SubagentStart",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "PreCompact",
  "PostCompact",
  "UserPromptSubmit",
  "SubagentStop",
  "Stop",
]);

const codex: AgentPlugin = {
  id: "codex",
  displayName: "OpenAI Codex",

  // Declarative: the skills domain links this directory to `.agnos/skills/`.
  // Codex picks up skills under `.agents/skills/<name>/` automatically.
  paths: {
    skillsDir: CODEX_SKILLS_DIR,
  },

  handles: {
    rules: {
      // onInitialize covers add/move/remove via the dispatcher fallback.
      async onInitialize(state, ctx) {
        if (state) {
          await writeRulesLink(state, ctx);
        } else {
          await removeRulesLinkIfManaged(ctx);
        }
      },
      async onCleanup(ctx) {
        await removeRulesLinkIfManaged(ctx);
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
    hooks: {
      // Codex hooks go in their own file (.codex/hooks.json) — keeping them out
      // of config.toml avoids clobbering the MCP servers written there.
      async onInitialize(state, ctx) {
        await writeCodexHooks(state, ctx);
      },
      async onImport(ctx) {
        return await importCodexHooks(ctx);
      },
      async onCleanup(ctx) {
        await fs.rm(path.join(ctx.projectRoot, CODEX_HOOKS), { force: true }).catch(() => {});
      },
    },
  },
};

// ---------- hooks (.codex/hooks.json) ----------

/** Keep only Codex-supported events and `command` handlers; warn on drops. */
function filterForCodex(
  state: HooksDeclaration | undefined,
  ctx: MaterializeContext,
): HooksDeclaration {
  const out: HooksDeclaration = {};
  if (!state) return out;
  let droppedEvents = 0;
  let droppedHandlers = 0;
  for (const [event, groups] of Object.entries(state)) {
    if (!CODEX_HOOK_EVENTS.has(event)) {
      droppedEvents++;
      continue;
    }
    const outGroups: HookMatcherGroup[] = [];
    for (const group of groups) {
      const commands = group.hooks.filter((h) => h.type === "command");
      droppedHandlers += group.hooks.length - commands.length;
      if (commands.length === 0) continue;
      outGroups.push({ ...group, hooks: commands });
    }
    if (outGroups.length > 0) out[event] = outGroups;
  }
  if (droppedEvents > 0) {
    ctx.logger.warn(
      `codex: skipped ${droppedEvents} unsupported hook event${droppedEvents === 1 ? "" : "s"}`,
    );
  }
  if (droppedHandlers > 0) {
    ctx.logger.warn(
      `codex: skipped ${droppedHandlers} non-command hook handler${droppedHandlers === 1 ? "" : "s"}`,
    );
  }
  return out;
}

async function writeCodexHooks(
  state: HooksDeclaration | undefined,
  ctx: MaterializeContext,
): Promise<void> {
  const file = path.join(ctx.projectRoot, CODEX_HOOKS);
  const filtered = filterForCodex(state, ctx);
  if (Object.keys(filtered).length === 0) {
    await fs.rm(file, { force: true }).catch(() => {});
    return;
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ hooks: filtered }, null, 2) + "\n", "utf8");
  const count = Object.keys(filtered).length;
  ctx.logger.info(`.codex/hooks.json (${count} hook event${count === 1 ? "" : "s"})`);
}

async function importCodexHooks(ctx: MaterializeContext): Promise<HooksDeclaration> {
  const file = path.join(ctx.projectRoot, CODEX_HOOKS);
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    ctx.logger.warn(`could not read ${CODEX_HOOKS}: ${(err as Error).message}`);
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    ctx.logger.warn(`${CODEX_HOOKS} is not valid JSON; skipping import`);
    return {};
  }
  const hooks = (parsed as { hooks?: unknown })?.hooks;
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) return {};
  return hooks as HooksDeclaration;
}

// ---------- helpers ----------

async function writeRulesLink(rule: ResolvedRule, ctx: MaterializeContext): Promise<void> {
  const rootAbs = path.resolve(ctx.projectRoot, ROOT_AGENTS);
  if (path.resolve(rule.absolutePath) === rootAbs) {
    ctx.logger.info(`AGENTS.md (in place)`);
    return;
  }
  await ctx.linker.link(rule.absolutePath, rootAbs, { fallback: "copy" });
  ctx.logger.info(`AGENTS.md → ${rule.relativeSource}`);
}

async function removeRulesLinkIfManaged(ctx: MaterializeContext): Promise<void> {
  const rootAgents = path.join(ctx.projectRoot, ROOT_AGENTS);
  try {
    const stat = await fs.lstat(rootAgents);
    if (stat.isSymbolicLink()) {
      await ctx.linker.unlink(rootAgents);
    }
  } catch {
    // missing — nothing to do
  }
}

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
