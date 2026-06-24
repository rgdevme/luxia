import fs from "node:fs/promises";
import path from "node:path";
import type {
  MaterializeContext,
  ResolveContext,
  ResolvedRule,
  RulesDeclaration,
} from "./types/public.js";
import { ensureLink } from "./fs/link.js";

/**
 * Per-agent materialization target. `agentRoot` is the project-relative base
 * where the agent reads its rule files (default "."); `agentFilename` is the
 * agent's own rule-file basename (e.g. "CLAUDE.md").
 */
export interface AgentRuleTarget {
  agentRoot: string;
  agentFilename: string;
}

/** Normalize a dir entry: posix separators, trimmed, no leading "./" or trailing "/". */
function normalizeDir(d: string): string {
  let t = d.replace(/\\/g, "/").trim();
  while (t.startsWith("./")) t = t.slice(2);
  t = t.replace(/\/+$/, "");
  return t === "" ? "." : t;
}

function toPosixRel(projectRoot: string, abs: string): string {
  const rel = path.relative(projectRoot, abs).split(path.sep).join("/");
  if (rel === "") return ".";
  if (rel.startsWith("..")) return rel;
  return `./${rel}`;
}

/**
 * Resolve a rules declaration into the full set of canonical rule files — one
 * for the root file (`<root>/<filename>`) plus one per `dirs` entry. Deduped by
 * resolved canonical path and sorted shallow→deep so ancestor files come first
 * (the order a flat/concatenating agent would want). Pure: creates no files.
 */
export function resolveRules(decl: RulesDeclaration, ctx: ResolveContext): ResolvedRule[] {
  const { filename = "AGENTS.md", root = ".", dirs = [] } = decl ?? {};
  const seen = new Map<string, ResolvedRule>();
  for (const rawDir of [".", ...dirs]) {
    const dir = normalizeDir(rawDir);
    const absolutePath = path.resolve(ctx.projectRoot, root, dir, filename);
    const key = path.resolve(absolutePath);
    if (seen.has(key)) continue;
    seen.set(key, {
      absolutePath,
      relativeSource: toPosixRel(ctx.projectRoot, absolutePath),
      dir,
      filename,
    });
  }
  return [...seen.values()].sort((a, b) => {
    const da = a.absolutePath.split(path.sep).length;
    const db = b.absolutePath.split(path.sep).length;
    return da !== db ? da - db : a.absolutePath.localeCompare(b.absolutePath);
  });
}

/** Resolve a single dir entry of a declaration into its canonical rule file. */
export function resolveRuleEntry(
  decl: RulesDeclaration,
  rawDir: string,
  ctx: ResolveContext,
): ResolvedRule {
  const dir = normalizeDir(rawDir);
  const filename = decl.filename ?? "AGENTS.md";
  const absolutePath = path.resolve(ctx.projectRoot, decl.root ?? ".", dir, filename);
  return { absolutePath, relativeSource: toPosixRel(ctx.projectRoot, absolutePath), dir, filename };
}

/** The materialized mirror path for one canonical rule under an agent's target. */
function mirrorPath(rule: ResolvedRule, target: AgentRuleTarget, projectRoot: string): string {
  return path.join(projectRoot, target.agentRoot, rule.dir, target.agentFilename);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Materialize one agent's mirror for every canonical rule file. For each rule:
 *  - skip + warn if the canonical source is missing on disk,
 *  - skip if the mirror path equals the canonical (in place — e.g. codex with
 *    root="." and filename="AGENTS.md"),
 *  - else symlink the mirror to the canonical (copy-fallback), preserving a real
 *    user-authored file already at the mirror path (EEXIST → warn + skip).
 * Honors `ctx.dryRun`.
 */
export async function materializeRuleMirrors(
  state: ResolvedRule[],
  target: AgentRuleTarget,
  ctx: MaterializeContext,
): Promise<void> {
  for (const rule of state) {
    const linkPath = mirrorPath(rule, target, ctx.projectRoot);
    if (path.resolve(linkPath) === path.resolve(rule.absolutePath)) {
      ctx.logger.info(`${target.agentFilename} (in place) ${rule.relativeSource}`);
      continue;
    }
    if (!(await pathExists(rule.absolutePath))) {
      ctx.logger.warn(`rules: canonical ${rule.relativeSource} is missing — skipping mirror`);
      continue;
    }
    const rel = toPosixRel(ctx.projectRoot, linkPath);
    if (ctx.dryRun) {
      ctx.logger.info(`would: link ${rel} → ${rule.relativeSource}`);
      continue;
    }
    try {
      const result = await ensureLink(rule.absolutePath, linkPath, ctx.linker, {
        fallback: "copy",
      });
      if (result.kind !== "already-linked") ctx.logger.info(`${rel} → ${rule.relativeSource}`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        ctx.logger.warn(`rules: ${rel} already exists and is not managed — leaving it untouched`);
        continue;
      }
      throw err;
    }
  }
}

/**
 * Remove one agent's mirrors for the given canonical rules. Used on
 * `agnos rules remove`, agent deactivation, and root/filename change — every
 * call site knows the exact paths, so this safely removes a copy OR a symlink.
 * Never touches a path equal to its canonical (the in-place guard protects the
 * source file). Honors `ctx.dryRun`.
 */
export async function pruneRuleMirrors(
  rules: ResolvedRule[],
  target: AgentRuleTarget,
  ctx: MaterializeContext,
): Promise<void> {
  for (const rule of rules) {
    const linkPath = mirrorPath(rule, target, ctx.projectRoot);
    if (path.resolve(linkPath) === path.resolve(rule.absolutePath)) continue;
    if (!(await pathExists(linkPath))) continue;
    const rel = toPosixRel(ctx.projectRoot, linkPath);
    if (ctx.dryRun) {
      ctx.logger.info(`would: remove ${rel}`);
      continue;
    }
    await ctx.linker.unlink(linkPath);
    ctx.logger.info(`removed ${rel}`);
  }
}
