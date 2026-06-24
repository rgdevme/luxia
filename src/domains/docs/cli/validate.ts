import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import type { CliCommand, ResolveContext } from "../../../core/index.js";
import {
  readEffectiveDocsConfig,
  initFiles,
  type EffectiveDocsConfig,
} from "../effective-config.js";

interface FileIssue {
  file: string;
  missing: string[];
}

export const validate: CliCommand = {
  description: "Check that every doc has the required frontmatter (--dry to report only)",
  async run(args, ctx) {
    const cfg = await readEffectiveDocsConfig(ctx);
    const result = await runValidate(cfg, ctx);
    const dry = args.flags["dry"] === true;
    if (result.issues.length === 0) {
      ctx.logger.success(`validated ${result.checked} file${result.checked === 1 ? "" : "s"}`);
      return;
    }
    const block = formatErrorBlock(cfg, result.issues, ctx);
    if (dry) {
      process.stdout.write(block + "\n");
      return;
    }
    process.stderr.write(block + "\n");
    process.exitCode = 1;
  },
};

export async function runValidate(
  cfg: EffectiveDocsConfig,
  ctx: ResolveContext,
): Promise<{ checked: number; issues: FileIssue[] }> {
  const files = await listUserDocs(cfg);
  const issues: FileIssue[] = [];
  for (const abs of files) {
    const issue = await checkFile(abs, cfg, ctx);
    if (issue) issues.push(issue);
  }
  return { checked: files.length, issues };
}

async function checkFile(
  abs: string,
  cfg: EffectiveDocsConfig,
  ctx: ResolveContext,
): Promise<FileIssue | null> {
  let raw: string;
  try {
    raw = await fs.readFile(abs, "utf8");
  } catch {
    return null;
  }
  const parsed = matter(raw);
  const data = (parsed.data ?? {}) as Record<string, unknown>;
  const missing: string[] = [];
  for (const key of Object.keys(cfg.metadata)) {
    if (!(key in data) || data[key] === undefined || data[key] === null || data[key] === "") {
      missing.push(key);
    }
  }
  if (missing.length === 0) return null;
  return { file: path.relative(ctx.projectRoot, abs), missing };
}

export async function listUserDocs(cfg: EffectiveDocsConfig): Promise<string[]> {
  const excluded = new Set(initFiles(cfg));
  const out: string[] = [];
  await walk(cfg.route, excluded, out);
  return out;
}

async function walk(dir: string, excluded: ReadonlySet<string>, acc: string[]): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(abs, excluded, acc);
    } else if (entry.isFile() && entry.name.endsWith(".md") && !excluded.has(abs)) {
      acc.push(abs);
    }
  }
}

function formatErrorBlock(
  cfg: EffectiveDocsConfig,
  issues: FileIssue[],
  _ctx: ResolveContext,
): string {
  const patternLines = Object.entries(cfg.metadata).map(
    ([key, description]) => `${key}: <value>    # ${description}`,
  );
  const lines: string[] = [];
  lines.push("The following files do not adhere to the documentation metadata standard.");
  lines.push("They should adhere to the following pattern:");
  lines.push("");
  lines.push("---");
  for (const l of patternLines) lines.push(l);
  lines.push("---");
  lines.push("");
  lines.push("Files to fix:");
  for (const issue of issues) {
    lines.push(`  - ${issue.file}`);
    if (issue.missing.length) lines.push(`      missing: ${issue.missing.join(", ")}`);
  }
  return lines.join("\n");
}

export { formatErrorBlock };
