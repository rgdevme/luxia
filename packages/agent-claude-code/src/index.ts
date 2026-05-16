import fs from "node:fs/promises";
import path from "node:path";
import type {
  AgentPlugin,
  MaterializeContext,
  ResolvedMcp,
  ResolvedRule,
  ResolvedSkill,
} from "@agnos/core";

const CLAUDE_RULES = "CLAUDE.md";
const CLAUDE_MCP = ".mcp.json";
const CLAUDE_SKILLS_DIR = path.join(".claude", "skills");

const claudeCode: AgentPlugin = {
  id: "claude-code",
  displayName: "Claude Code",

  handles: {
    rules: {
      // onInitialize handles all add/move/remove via fallback in events.ts —
      // the output is a single file (CLAUDE.md) so we just write/relink each time.
      async onInitialize(state, ctx) {
        if (state) {
          await writeRulesLink(state, ctx);
        } else {
          await removeRulesLink(ctx);
        }
      },
      async onCleanup(ctx) {
        await removeRulesLink(ctx);
      },
    },
    mcp: {
      // Same single-file regeneration story; onAdded/onUpdated/onRemoved fall
      // back to onInitialize with the full mcp[] state.
      async onInitialize(state, ctx) {
        await writeMcpFile(state, ctx);
      },
      async onCleanup(ctx) {
        await removeMcpFile(ctx);
      },
    },
    skills: {
      // Per-skill incremental; each skill is its own junction.
      async onInitialize(state, ctx) {
        await materializeSkills(state, ctx);
      },
      async onAdded(item, ctx) {
        await ensureSkillLink(item, ctx);
      },
      async onUpdated(item, ctx) {
        await ensureSkillLink(item, ctx);
      },
      async onRemoved(name, ctx) {
        await removeSkillLink(name, ctx);
      },
      async onCleanup(ctx) {
        await fs
          .rm(path.join(ctx.projectRoot, CLAUDE_SKILLS_DIR), { recursive: true, force: true })
          .catch(() => {});
      },
    },
  },
};

// ---------- single-write helpers ----------

async function writeRulesLink(rule: ResolvedRule, ctx: MaterializeContext): Promise<void> {
  const linkPath = path.join(ctx.projectRoot, CLAUDE_RULES);
  if (path.resolve(linkPath) === path.resolve(rule.absolutePath)) return;
  await ctx.linker.link(rule.absolutePath, linkPath, { fallback: "copy" });
  ctx.logger.info(`CLAUDE.md → ${rule.relativeSource}`);
}

async function removeRulesLink(ctx: MaterializeContext): Promise<void> {
  try {
    await ctx.linker.unlink(path.join(ctx.projectRoot, CLAUDE_RULES));
  } catch {
    // ignore
  }
}

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

async function materializeSkills(items: ResolvedSkill[], ctx: MaterializeContext): Promise<void> {
  const dir = path.join(ctx.projectRoot, CLAUDE_SKILLS_DIR);
  await fs.mkdir(dir, { recursive: true });
  for (const s of items) {
    await ensureSkillLink(s, ctx);
  }
  ctx.logger.info(`.claude/skills/ (${items.length} skill${items.length === 1 ? "" : "s"})`);
}

async function ensureSkillLink(item: ResolvedSkill, ctx: MaterializeContext): Promise<void> {
  const dir = path.join(ctx.projectRoot, CLAUDE_SKILLS_DIR);
  await fs.mkdir(dir, { recursive: true });
  await ctx.linker.link(item.absolutePath, path.join(dir, item.name));
}

async function removeSkillLink(name: string, ctx: MaterializeContext): Promise<void> {
  const target = path.join(ctx.projectRoot, CLAUDE_SKILLS_DIR, name);
  try {
    await ctx.linker.unlink(target);
  } catch {
    await fs.rm(target, { recursive: true, force: true }).catch(() => {});
  }
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
