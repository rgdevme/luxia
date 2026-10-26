import fs from "node:fs/promises";
import path from "node:path";
import type {
  HarnessAdapter,
  MaterializeContext,
  McpDeclaration,
  ResolvedMcp,
  SkillMetadataDiagnostic,
  SkillMetadataValidationInput,
} from "../../../core/index.js";
import { validateRequiredSkillFields } from "../../../core/skill-metadata.js";
import {
  importMcpServers,
  pickEnv,
  pickEnvKeys,
  pickStringArray,
  readConfigOrDefault,
} from "../../../core/index.js";
import {
  linkSkills,
  mirrorRules,
  removePaths,
  ruleMirrorPaths,
  writeIfChanged,
} from "../shared.js";

const CLAUDE_RULES = "CLAUDE.md";
const CLAUDE_MCP = ".mcp.json";
const CLAUDE_SKILLS_DIR = path.join(".claude", "skills");

const claudeCode: HarnessAdapter = {
  id: "claude-code",
  displayName: "Claude Code",
  paths: { skillsDir: CLAUDE_SKILLS_DIR, rulesFilename: CLAUDE_RULES, rulesRoot: "." },
  validateSkillMetadata(input: SkillMetadataValidationInput): SkillMetadataDiagnostic[] {
    return validateRequiredSkillFields(this.id, input.name, input.directory, input.frontmatter, [
      "name",
      "description",
    ]);
  },

  render: {
    async rules(state, ctx) {
      await mirrorRules(state as string[], CLAUDE_RULES, ctx);
    },
    async mcp(state, ctx) {
      await writeMcpFile(state as ResolvedMcp[], ctx);
    },
    async skills(state, ctx) {
      await linkSkills(CLAUDE_SKILLS_DIR, state as Record<string, string>, ctx);
    },
  },

  scrape: {
    mcp: (ctx) => importMcpFile(ctx),
    skills: (ctx) => listSkillDirs(ctx),
  },

  async claims(ctx) {
    const config = await readConfigOrDefault(ctx.configPath);
    const canonical = Object.keys(config.rules?.fragments ?? {});
    return [
      ...ruleMirrorPaths(canonical, CLAUDE_RULES, ctx.projectRoot),
      path.join(ctx.projectRoot, CLAUDE_MCP),
    ];
  },
};

// ---------- mcp (.mcp.json) ----------

async function writeMcpFile(servers: ResolvedMcp[], ctx: MaterializeContext): Promise<void> {
  const file = path.join(ctx.projectRoot, CLAUDE_MCP);
  // No servers declared → ensure the file is absent rather than writing an empty one.
  if (servers.length === 0) {
    if (ctx.dryRun) {
      ctx.logger.info(`would: remove ${CLAUDE_MCP} (no mcp servers)`);
      return;
    }
    await fs.rm(file, { force: true }).catch(() => {});
    return;
  }
  const out = { mcpServers: Object.fromEntries(servers.map((m) => [m.name, toClaudeServer(m)])) };
  const content = JSON.stringify(out, null, 2) + "\n";
  await writeIfChanged(file, content, ctx, `${CLAUDE_MCP} (${servers.length} servers)`);
}

async function importMcpFile(ctx: MaterializeContext): Promise<McpDeclaration[]> {
  return await importMcpServers(ctx, {
    relativePath: CLAUDE_MCP,
    format: "JSON",
    parse: (raw) => JSON.parse(raw),
    containerKey: "mcpServers",
    fromEntry: fromClaudeServer,
  });
}

function fromClaudeServer(name: string, entry: unknown): McpDeclaration | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const e = entry as Record<string, unknown>;
  const type = typeof e["type"] === "string" ? (e["type"] as string) : undefined;
  if (type === "sse" || type === "http") {
    const url = typeof e["url"] === "string" ? (e["url"] as string) : undefined;
    if (!url) return undefined;
    const decl: McpDeclaration = { name, transport: type, command: url };
    const env = pickEnvKeys(e["env"]);
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
  const env = pickEnvKeys(e["env"]);
  if (env) decl.env = env;
  return decl;
}

function toClaudeServer(decl: ResolvedMcp): Record<string, unknown> {
  if (decl.transport && decl.transport !== "stdio") {
    return {
      type: decl.transport,
      url: decl.command,
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

// ---------- skills (scrape) ----------

async function listSkillDirs(ctx: MaterializeContext): Promise<string[]> {
  const dir = path.join(ctx.projectRoot, CLAUDE_SKILLS_DIR);
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() || e.isSymbolicLink()).map((e) => e.name);
  } catch {
    return [];
  }
}

export { removePaths };
export default claudeCode;
