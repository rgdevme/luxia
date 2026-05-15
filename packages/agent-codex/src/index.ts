import fs from "node:fs/promises";
import path from "node:path";
import TOML from "@iarna/toml";
import type {
  AgentPlugin,
  MaterializeContext,
  ResolvedMcp,
  ResolvedRule,
} from "@agnos/core";

const ROOT_AGENTS = "AGENTS.md";
const CODEX_CONFIG = path.join(".codex", "config.toml");

const codex: AgentPlugin = {
  id: "codex",
  displayName: "OpenAI Codex",

  supports: {
    async rules(items, ctx) {
      const rule = items[0];
      if (!rule) return;
      const rootAbs = path.resolve(ctx.projectRoot, ROOT_AGENTS);
      // Codex reads ./AGENTS.md natively. If that's where the rules live, no-op.
      if (path.resolve(rule.absolutePath) === rootAbs) {
        ctx.logger.info(`  AGENTS.md (in place)`);
        return;
      }
      // Otherwise create ./AGENTS.md as a symlink to the actual rules file.
      await ctx.linker.link(rule.absolutePath, rootAbs, { fallback: "copy" });
      ctx.logger.info(`  AGENTS.md → ${rule.relativeSource}`);
    },

    async mcp(items, ctx) {
      const tomlObj: Record<string, unknown> = {
        mcp_servers: Object.fromEntries(items.map((m) => [m.name, toCodexServer(m)])),
      };
      const file = path.join(ctx.projectRoot, CODEX_CONFIG);
      await fs.mkdir(path.dirname(file), { recursive: true });
      const content = TOML.stringify(tomlObj as TOML.JsonMap);
      await fs.writeFile(file, content, "utf8");
      ctx.logger.info(`  .codex/config.toml (${items.length} server${items.length === 1 ? "" : "s"})`);
    },
  },

  async cleanup(ctx: MaterializeContext) {
    // Remove ./AGENTS.md ONLY if it is a symlink we created (don't nuke the user's real file).
    const rootAgents = path.join(ctx.projectRoot, ROOT_AGENTS);
    const stat = await safeLstat(rootAgents);
    if (stat?.isSymbolicLink()) {
      try {
        await ctx.linker.unlink(rootAgents);
      } catch {
        // ignore
      }
    }
    // Remove the codex config we wrote.
    await safeRm(path.join(ctx.projectRoot, ".codex"));
    ctx.logger.info("Codex artifacts removed");
  },
};

function toCodexServer(decl: ResolvedMcp): Record<string, unknown> {
  // Codex's TOML schema lives at https://github.com/openai/codex/...; we mirror the documented stdio shape.
  const out: Record<string, unknown> = {};
  if (decl.command) out["command"] = decl.command;
  if (decl.args) out["args"] = decl.args;
  if (decl.env) out["env"] = decl.env;
  if (decl.transport && decl.transport !== "stdio") out["transport"] = decl.transport;
  return out;
}

async function safeLstat(p: string) {
  try {
    return await fs.lstat(p);
  } catch {
    return null;
  }
}

async function safeRm(p: string): Promise<void> {
  try {
    await fs.rm(p, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

export default codex;
