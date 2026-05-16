import { input, select } from "@inquirer/prompts";
import type {
  DomainPlugin,
  McpDeclaration,
  ResolvedMcp,
} from "@agnos/core";
import { mcpDeclarationSchema, readConfigOrDefault } from "@agnos/core";

const mcpPlugin: DomainPlugin<McpDeclaration, ResolvedMcp> = {
  name: "mcp",
  priority: 20,
  declarationSchema: mcpDeclarationSchema,

  async onInitialize(_ctx) {
    // no per-domain bootstrap needed
  },

  async resolve(decl) {
    return { ...decl };
  },

  async add(ref) {
    const name = ref;
    const transport = await select<"stdio" | "sse" | "http">({
      message: `Transport for ${name}`,
      choices: [
        { name: "stdio (local subprocess)", value: "stdio" },
        { name: "sse (Server-Sent Events)", value: "sse" },
        { name: "http (streamable HTTP)", value: "http" },
      ],
      default: "stdio",
    });
    if (transport === "stdio") {
      const command = await input({ message: "Command (e.g. npx):", default: "npx" });
      const argsRaw = await input({ message: "Args (space-separated, leave empty if none):" });
      const envRaw = await input({ message: "Env (KEY=value, comma-separated, leave empty if none):" });
      const args = argsRaw.trim() ? splitArgs(argsRaw) : undefined;
      const env = parseEnv(envRaw);
      const decl: ResolvedMcp = { name, command, transport: "stdio" };
      if (args && args.length > 0) decl.args = args;
      if (env && Object.keys(env).length > 0) decl.env = env;
      return decl;
    }
    const urlPrompt = await input({ message: `URL for ${name}:` });
    return { name, transport, command: urlPrompt };
  },

  async remove(_name) {
    // No persisted files to clean — agent plugins fully rewrite their MCP config each replay.
  },

  async update(name, ctx) {
    const config = await readConfigOrDefault(ctx.configPath);
    const existing = (config.mcp ?? []).find((m) => m.name === name);
    if (!existing) throw new Error(`mcp "${name}" not declared in agnos.json`);
    return { ...existing };
  },

  async list(ctx) {
    const config = await readConfigOrDefault(ctx.configPath);
    return (config.mcp ?? []).map((m) => ({ ...m }));
  },
};

function splitArgs(s: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === " ") {
      if (current) {
        out.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) out.push(current);
  return out;
}

function parseEnv(s: string): Record<string, string> | undefined {
  const trimmed = s.trim();
  if (!trimmed) return undefined;
  const out: Record<string, string> = {};
  for (const pair of trimmed.split(",")) {
    const [key, ...rest] = pair.split("=");
    if (!key) continue;
    out[key.trim()] = rest.join("=").trim();
  }
  return out;
}

export default mcpPlugin;
