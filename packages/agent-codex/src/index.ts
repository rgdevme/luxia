import fs from "node:fs/promises";
import path from "node:path";
import TOML from "@iarna/toml";
import type {
  AgentPlugin,
  MaterializeContext,
  ResolvedMcp,
  ResolvedRule,
} from "@agnos/core";
import { readConfigOrDefault } from "@agnos/core";

const ROOT_AGENTS = "AGENTS.md";
const CODEX_CONFIG = path.join(".codex", "config.toml");

const codex: AgentPlugin = {
  id: "codex",
  displayName: "OpenAI Codex",

  async onReplay(state, ctx) {
    if (state.rules) {
      await writeRulesLink(state.rules, ctx);
    } else {
      await removeRulesLinkIfManaged(ctx);
    }
    await writeCodexConfig(state.mcp, ctx);
  },

  async onDeactivated(ctx) {
    await removeAllArtifacts(ctx);
  },

  async onUninstalled(ctx) {
    await removeAllArtifacts(ctx);
  },

  handles: {
    rules: {
      async onAdded(decl, ctx) {
        await writeRulesLink(decl, ctx);
      },
      async onMoved(_from, to, ctx) {
        await writeRulesLink(to, ctx);
      },
      async onRemoved(_decl, ctx) {
        await removeRulesLinkIfManaged(ctx);
      },
    },
    mcp: {
      async onAdded(_item, ctx) {
        await rewriteCodexFromConfig(ctx);
      },
      async onUpdated(_item, ctx) {
        await rewriteCodexFromConfig(ctx);
      },
      async onRemoved(_name, ctx) {
        await rewriteCodexFromConfig(ctx);
      },
    },
  },
};

// ---------- helpers ----------

/**
 * Codex reads `./AGENTS.md` natively. If the rules source is at that exact path,
 * we no-op. Otherwise we create ./AGENTS.md as a symlink to the source.
 */
async function writeRulesLink(rule: ResolvedRule, ctx: MaterializeContext): Promise<void> {
  const rootAbs = path.resolve(ctx.projectRoot, ROOT_AGENTS);
  if (path.resolve(rule.absolutePath) === rootAbs) {
    ctx.logger.info(`  AGENTS.md (in place)`);
    return;
  }
  await ctx.linker.link(rule.absolutePath, rootAbs, { fallback: "copy" });
  ctx.logger.info(`  AGENTS.md → ${rule.relativeSource}`);
}

/**
 * Only remove `./AGENTS.md` if it's a symlink we created — never delete the user's
 * real file.
 */
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
  ctx.logger.info(`  .codex/config.toml (${servers.length} server${servers.length === 1 ? "" : "s"})`);
}

async function rewriteCodexFromConfig(ctx: MaterializeContext): Promise<void> {
  const config = await readConfigOrDefault(ctx.configPath);
  await writeCodexConfig((config.mcp ?? []) as ResolvedMcp[], ctx);
}

async function removeAllArtifacts(ctx: MaterializeContext): Promise<void> {
  await removeRulesLinkIfManaged(ctx);
  await fs.rm(path.join(ctx.projectRoot, ".codex"), { recursive: true, force: true }).catch(() => {});
  ctx.logger.info("Codex artifacts removed");
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
