import fs from "node:fs/promises";
import path from "node:path";
import { readConfigOrDefault } from "./config.js";
import {
  type AgentRuleTarget,
  materializeRuleMirrors,
  pruneRuleMirrors,
  resolveRules,
} from "./materialize-rules.js";
import type { MaterializeContext, McpDeclaration, RulesEventHandlers } from "./types/public.js";

// ---------- rules ----------

/**
 * Build the standard rules handler for an agent that mirrors every canonical
 * rule file under a fixed target (its own filename + root). The whole block is
 * identical across agents — only `target` differs — so plugins just call
 * `createRuleMirrorHandler(RULES_TARGET)` instead of repeating it.
 */
export function createRuleMirrorHandler(target: AgentRuleTarget): RulesEventHandlers {
  return {
    async onInitialize(state, ctx) {
      await materializeRuleMirrors(state, target, ctx);
    },
    async onCleanup(ctx) {
      const config = await readConfigOrDefault(ctx.configPath);
      if (!config.rules) return;
      await pruneRuleMirrors(resolveRules(config.rules, ctx), target, ctx);
    },
  };
}

// ---------- MCP declaration parsing ----------

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
 * errors → warn + [] (never throws, per the `onImport` contract) — leaving each
 * agent only its parser (`parse`), container key, and per-entry mapper
 * (`fromEntry`).
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
