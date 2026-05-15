import fs from "node:fs/promises";
import path from "node:path";
import type {
  AgentPlugin,
  MaterializeContext,
  ResolvedMcp,
  ResolvedRule,
  ResolvedSkill,
} from "@agnos/core";
import { pruneAgentSkillDir } from "@agnos/core";

const CLAUDE_RULES = "CLAUDE.md";
const CLAUDE_MCP = ".mcp.json";
const CLAUDE_SKILLS = path.join(".claude", "skills");

const claudeCode: AgentPlugin = {
  id: "claude-code",
  displayName: "Claude Code",

  supports: {
    async rules(items, ctx) {
      const rule = items[0];
      if (!rule) return;
      const linkPath = path.join(ctx.projectRoot, CLAUDE_RULES);
      if (path.resolve(linkPath) === path.resolve(rule.absolutePath)) return; // can't link to self
      await ctx.linker.link(rule.absolutePath, linkPath, { fallback: "copy" });
      ctx.logger.info(`  CLAUDE.md → ${rule.relativeSource}`);
    },

    async mcp(items, ctx) {
      const out = {
        mcpServers: Object.fromEntries(items.map((m) => [m.name, toClaudeServer(m)])),
      };
      const file = path.join(ctx.projectRoot, CLAUDE_MCP);
      await fs.writeFile(file, JSON.stringify(out, null, 2) + "\n", "utf8");
      ctx.logger.info(`  .mcp.json (${items.length} server${items.length === 1 ? "" : "s"})`);
    },

    async skills(items, ctx) {
      const dir = path.join(ctx.projectRoot, CLAUDE_SKILLS);
      await fs.mkdir(dir, { recursive: true });
      const declared = new Set(items.map((s) => s.name));
      for (const s of items) {
        const linkPath = path.join(dir, s.name);
        await ctx.linker.link(s.absolutePath, linkPath);
      }
      const removed = await pruneAgentSkillDir(dir, declared);
      if (removed.length) ctx.logger.info(`  pruned skill link${removed.length === 1 ? "" : "s"}: ${removed.join(", ")}`);
      ctx.logger.info(`  .claude/skills/ (${items.length} skill${items.length === 1 ? "" : "s"})`);
    },
  },

  async cleanup(ctx: MaterializeContext) {
    await safeUnlink(path.join(ctx.projectRoot, CLAUDE_RULES), ctx);
    await safeUnlink(path.join(ctx.projectRoot, CLAUDE_MCP), ctx);
    await safeRm(path.join(ctx.projectRoot, ".claude", "skills"), ctx);
    // Don't remove .claude itself — the user may have other things there.
    ctx.logger.info("Claude Code artifacts removed");
  },
};

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

async function safeUnlink(p: string, ctx: MaterializeContext): Promise<void> {
  try {
    await ctx.linker.unlink(p);
  } catch {
    // ignore
  }
}

async function safeRm(p: string, ctx: MaterializeContext): Promise<void> {
  try {
    await fs.rm(p, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

export default claudeCode;
