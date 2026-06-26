import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import type { AgnosConfig, ResolveContext } from "../../core/index.js";

export const DEFAULT_DOCS_ROOT = ".docs";
export const INDEX_FILE = "index.md";

/** Opinionated metadata every doc should carry; user `metadata` merges onto this. */
export const DEFAULT_DOCS_METADATA: Record<string, string> = {
  title: "Short, human-readable title of the document.",
  description: "One- or two-sentence summary of what the document covers.",
  read_when:
    "Natural-language description of when an agent should read this document (e.g., 'when implementing authentication').",
  agent_cant:
    "What the agent must not do with this file. One of: read, write, delete (or a natural-language combination).",
};

/** Effective metadata = opinionated defaults with the user's map merged on top. */
export function effectiveMetadata(config: AgnosConfig): Record<string, string> {
  return { ...DEFAULT_DOCS_METADATA, ...(config.docs?.metadata ?? {}) };
}

interface DocEntry {
  rel: string;
  topDir: string;
  title: string;
  description: string;
}

async function listDocs(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) await walk(abs);
      else if (e.isFile() && e.name.endsWith(".md")) out.push(abs);
    }
  }
  await walk(root);
  return out;
}

function renderIndexBody(docs: DocEntry[]): string {
  if (docs.length === 0) {
    return "_No documentation yet. Add markdown files under this directory._";
  }
  const groups = new Map<string, DocEntry[]>();
  for (const d of docs) {
    const key = d.topDir === "" ? "Overview" : d.topDir;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(d);
  }
  const order = [...groups.keys()].sort((a, b) => {
    if (a === "Overview") return -1;
    if (b === "Overview") return 1;
    return a.localeCompare(b);
  });
  const lines: string[] = [];
  for (const section of order) {
    lines.push(`### ${section}`);
    const items = (groups.get(section) ?? []).sort((a, b) => a.title.localeCompare(b.title));
    for (const d of items) {
      lines.push(`- [${d.title}](${d.rel})${d.description ? `: ${d.description}` : ""}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

export interface CompileResult {
  written: boolean;
  missing: { file: string; keys: string[] }[];
}

/**
 * Compile a deterministic, byte-stable index from the docs under `docs.root`.
 * Missing declared metadata keys warn and continue (§13.6); the index file
 * excludes itself from the scan and carries a `title` so `rules` can inject it.
 */
export async function compileDocsIndex(
  config: AgnosConfig,
  ctx: ResolveContext,
): Promise<CompileResult> {
  const root = path.resolve(ctx.projectRoot, config.docs?.root ?? DEFAULT_DOCS_ROOT);
  const indexAbs = path.join(root, INDEX_FILE);
  const meta = effectiveMetadata(config);
  const metaKeys = Object.keys(meta);

  const files = (await listDocs(root)).filter((abs) => abs !== indexAbs);
  const docs: DocEntry[] = [];
  const missing: { file: string; keys: string[] }[] = [];

  for (const abs of files) {
    const data = (matter(await fs.readFile(abs, "utf8")).data ?? {}) as Record<string, unknown>;
    const miss = metaKeys.filter((k) => data[k] === undefined || data[k] === "");
    const rel = path.relative(root, abs).split(path.sep).join("/");
    if (miss.length > 0) missing.push({ file: rel, keys: miss });
    const segs = rel.split("/");
    docs.push({
      rel,
      topDir: segs.length > 1 ? segs[0]! : "",
      title: typeof data["title"] === "string" ? data["title"] : path.basename(abs, ".md"),
      description: typeof data["description"] === "string" ? data["description"] : "",
    });
  }

  const text = `---\ntitle: Documentation Index\n---\n\n${renderIndexBody(docs)}\n`;

  let written = false;
  let existing: string | null = null;
  try {
    existing = await fs.readFile(indexAbs, "utf8");
  } catch {
    existing = null;
  }
  if (existing !== text) {
    if (ctx.dryRun) {
      ctx.logger.info(`would: write ${path.relative(ctx.projectRoot, indexAbs)}`);
    } else {
      await fs.mkdir(root, { recursive: true });
      await fs.writeFile(indexAbs, text, "utf8");
      written = true;
    }
  }

  if (missing.length > 0) {
    const shape = metaKeys.map((k) => `${k}: ${meta[k]}`).join("\n");
    ctx.logger.warn(
      `The following files are missing some metadata properties:\n${shape}\n` +
        missing.map((m) => `- ${m.file}: ${m.keys.join(", ")}`).join("\n"),
    );
  }

  return { written, missing };
}
