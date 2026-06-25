import fs from "node:fs/promises";
import path from "node:path";
import type { MaterializeContext, McpDeclaration } from "./types/public.js";

/** Coerce a value to a `string[]` only if every element is a string. */
export function pickStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((x): x is string => typeof x === "string");
  return out.length === value.length ? out : undefined;
}

/** Coerce a value to a `Record<string, string>`, dropping non-string values. */
export function pickEnv(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Read an agent's native MCP config file and return the centralizable
 * declarations. Handles the shared skeleton — missing file → [], read/parse
 * errors → warn + [] (never throws) — leaving each agent only its parser, the
 * container key, and a per-entry mapper.
 */
export async function importMcpServers(
  ctx: MaterializeContext,
  opts: {
    relativePath: string;
    format: string;
    parse: (raw: string) => unknown;
    containerKey: string;
    fromEntry: (name: string, entry: unknown) => McpDeclaration | undefined;
  },
): Promise<McpDeclaration[]> {
  const file = path.join(ctx.projectRoot, opts.relativePath);
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    ctx.logger.warn(`could not read ${opts.relativePath}: ${(err as Error).message}`);
    return [];
  }
  let parsed: unknown;
  try {
    parsed = opts.parse(raw);
  } catch {
    ctx.logger.warn(`${opts.relativePath} is not valid ${opts.format}; skipping import`);
    return [];
  }
  const servers = (parsed as Record<string, unknown> | null)?.[opts.containerKey];
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) return [];
  const out: McpDeclaration[] = [];
  for (const [name, entry] of Object.entries(servers as Record<string, unknown>)) {
    const decl = opts.fromEntry(name, entry);
    if (decl) out.push(decl);
  }
  return out;
}
