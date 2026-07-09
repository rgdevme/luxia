import fs from "node:fs/promises";
import path from "node:path";
import type {
  MaterializeContext,
  McpConfig,
  McpDeclaration,
  ResolvedMcp,
} from "../../core/index.js";

const DEFAULT_MCP_ENV_FILE = ".env.local";

export async function resolveMcpServers(
  config: McpConfig | undefined,
  ctx: MaterializeContext,
): Promise<ResolvedMcp[]> {
  const servers = config?.servers ?? [];
  const requiredKeys = [...new Set(servers.flatMap((server) => server.env ?? []))];
  if (requiredKeys.length === 0) return servers.map(withoutEnvKeys);

  const envFile = config?.envFile ?? DEFAULT_MCP_ENV_FILE;
  const values = await readEnvFile(path.resolve(ctx.projectRoot, envFile), envFile);
  const missing = requiredKeys.filter((key) => !values.has(key) || values.get(key) === "");
  if (missing.length > 0) {
    throw new Error(`mcp env file "${envFile}" is missing required keys: ${missing.join(", ")}`);
  }

  return servers.map((server) => {
    const resolved = withoutEnvKeys(server);
    if (server.env && server.env.length > 0) {
      resolved.env = Object.fromEntries(
        server.env.map((key) => {
          const value = values.get(key);
          if (value === undefined) throw new Error(`mcp env key "${key}" disappeared`);
          return [key, value];
        }),
      );
    }
    return resolved;
  });
}

function withoutEnvKeys(server: McpDeclaration): ResolvedMcp {
  const { env: _env, ...rest } = server;
  return { ...rest };
}

async function readEnvFile(file: string, label: string): Promise<Map<string, string>> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`mcp env file "${label}" was not found`);
    }
    throw new Error(`could not read mcp env file "${label}": ${(err as Error).message}`, {
      cause: err,
    });
  }
  return parseEnvFile(raw);
}

function parseEnvFile(raw: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1];
    if (!key) continue;
    out.set(key, parseEnvValue(match[2] ?? ""));
  }
  return out;
}

function parseEnvValue(raw: string): string {
  const value = raw.trim();
  if (value.length < 2) return value;
  const quote = value[0];
  if ((quote === `"` || quote === "'") && value.endsWith(quote)) {
    const inner = value.slice(1, -1);
    if (quote === "'") return inner;
    return inner
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, `"`)
      .replace(/\\\\/g, "\\");
  }
  return stripInlineComment(value).trimEnd();
}

function stripInlineComment(value: string): string {
  const index = value.search(/\s#/);
  return index >= 0 ? value.slice(0, index) : value;
}
