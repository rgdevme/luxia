import fs from "node:fs/promises";
import path from "node:path";
import TOML from "@iarna/toml";
import type { AgentPlugin, MaterializeContext, ResolvedMcp, ResolvedRule } from "@luxia/core";

const ROOT_AGENTS = "AGENTS.md";
const CODEX_DIR = ".codex";
const CODEX_CONFIG = path.join(CODEX_DIR, "config.toml");

const codex: AgentPlugin = {
  id: "codex",
  displayName: "OpenAI Codex",

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

function toCodexServer(decl: ResolvedMcp): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (decl.command) out["command"] = decl.command;
  if (decl.args) out["args"] = decl.args;
  if (decl.env) out["env"] = decl.env;
  if (decl.transport && decl.transport !== "stdio") out["transport"] = decl.transport;
  return out;
}

export default codex;
