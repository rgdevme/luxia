import fs from "node:fs/promises";
import path from "node:path";
import TOML from "@iarna/toml";
import type {
  HarnessAdapter,
  MaterializeContext,
  McpDeclaration,
  ResolvedMcp,
  SkillMetadataDiagnostic,
  SkillMetadataValidationInput,
} from "../../../core/index.js";
import { importMcpServers, pickEnv, pickEnvKeys, pickStringArray } from "../../../core/index.js";
import { validateRequiredSkillFields } from "../../../core/skill-metadata.js";
import { linkSkills, mirrorRules, removePaths, writeIfChanged } from "../shared.js";

const CODEX_RULES = "AGENTS.md";
const CODEX_DIR = ".codex";
const CODEX_CONFIG = path.join(CODEX_DIR, "config.toml");
const CODEX_SKILLS_DIR = path.join(".agents", "skills");

const codex: HarnessAdapter = {
  id: "codex",
  displayName: "OpenAI Codex",
  paths: { skillsDir: CODEX_SKILLS_DIR, rulesFilename: CODEX_RULES, rulesRoot: "." },
  validateSkillMetadata(input: SkillMetadataValidationInput): SkillMetadataDiagnostic[] {
    const diagnostics = validateRequiredSkillFields(
      this.id,
      input.name,
      input.directory,
      input.frontmatter,
      ["name", "description"],
    );
    const name = input.frontmatter["name"];
    if (typeof name === "string" && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
      diagnostics.push({
        code: "skill-metadata-invalid-name",
        harnessId: this.id,
        skillName: input.name,
        file: path.join(input.directory, "SKILL.md"),
        field: "name",
        message:
          "Codex skill names must use lowercase letters, numbers, and single hyphen separators",
      });
    }
    const description = input.frontmatter["description"];
    if (typeof description === "string" && description.length > 1024) {
      diagnostics.push({
        code: "skill-metadata-description-too-long",
        harnessId: this.id,
        skillName: input.name,
        file: path.join(input.directory, "SKILL.md"),
        field: "description",
        message: "Codex skill descriptions must not exceed 1024 characters",
      });
    }
    return diagnostics;
  },

  render: {
    async rules(state, ctx) {
      // Codex reads AGENTS.md in place; mirrorRules no-ops when the canonical
      // basename already matches, so this only acts on differently-named canon.
      await mirrorRules(state as string[], CODEX_RULES, ctx);
    },
    async mcp(state, ctx) {
      await writeCodexConfig(state as ResolvedMcp[], ctx);
    },
    async skills(state, ctx) {
      await linkSkills(CODEX_SKILLS_DIR, state as Record<string, string>, ctx);
    },
  },

  scrape: {
    mcp: (ctx) => importCodexConfig(ctx),
    skills: () => Promise.resolve([]),
  },

  async cleanup(ctx) {
    await writeCodexConfig([], ctx);
  },

  claims() {
    return [];
  },
};

// ---------- mcp (.codex/config.toml) ----------

async function writeCodexConfig(servers: ResolvedMcp[], ctx: MaterializeContext): Promise<void> {
  const file = path.join(ctx.projectRoot, CODEX_CONFIG);
  let config: Record<string, unknown> = {};
  try {
    config = TOML.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      ctx.logger.warn(`${CODEX_CONFIG} is not valid TOML; skipping MCP update`);
      return;
    }
  }
  if (servers.length > 0) {
    config["mcp_servers"] = Object.fromEntries(servers.map((m) => [m.name, toCodexServer(m)]));
  } else {
    delete config["mcp_servers"];
  }
  if (Object.keys(config).length === 0) {
    if (ctx.dryRun) {
      ctx.logger.info(`would: remove ${CODEX_CONFIG} (no managed settings)`);
      return;
    }
    await fs.rm(file, { force: true }).catch(() => {});
    return;
  }
  const content = TOML.stringify(config as TOML.JsonMap);
  await writeIfChanged(file, content, ctx, `${CODEX_CONFIG} (${servers.length} servers)`);
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
  const env = pickEnvKeys(e["env"]);
  if (env) decl.env = env;
  const headers = pickEnv(e["headers"]);
  if (headers) decl.headers = headers;
  return decl;
}

function toCodexServer(decl: ResolvedMcp): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (decl.command) out["command"] = decl.command;
  if (decl.args) out["args"] = decl.args;
  if (decl.env) out["env"] = decl.env;
  if (decl.headers) out["headers"] = decl.headers;
  if (decl.transport && decl.transport !== "stdio") out["transport"] = decl.transport;
  return out;
}

export { removePaths };
export default codex;
