import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import type { AgnosConfig, ResolveContext } from "../../core/index.js";
import { docFrontmatterSchema } from "../../core/index.js";

export const DEFAULT_DOCS_ROOT = ".docs";
export const INDEX_FILE = "index.md";
export const LOG_FILE = "log.md";

/** OKF reserved filenames excluded from the concept-document scan. */
const RESERVED_FILES = new Set([INDEX_FILE, LOG_FILE]);

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
    lines.push(`### ${section}`, "");
    const items = (groups.get(section) ?? []).sort((a, b) => a.title.localeCompare(b.title));
    for (const d of items) {
      lines.push(`- [${d.title}](${d.rel})${d.description ? `: ${d.description}` : ""}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

/** The fixed frontmatter shape rendered as `key: <hint>` lines, in schema order. */
function metadataShape(): string {
  return Object.entries(docFrontmatterSchema.shape)
    .map(([key, schema]) => `${key}: ${schema.description ?? ""}`)
    .join("\n");
}

export interface CompileResult {
  written: boolean;
  /** Relative paths of docs whose frontmatter does not satisfy `docFrontmatterSchema`. */
  incomplete: string[];
}

/**
 * Compile a deterministic, byte-stable index from the docs under `docs.root`.
 * Docs whose frontmatter is incomplete warn and continue; the reserved
 * `index.md`/`log.md` files are excluded from the scan, and the index carries a
 * `title` so `rules` can inject it.
 */
export async function compileDocsIndex(
  config: AgnosConfig,
  ctx: ResolveContext,
): Promise<CompileResult> {
  const root = path.resolve(ctx.projectRoot, config.docs?.root ?? DEFAULT_DOCS_ROOT);
  const indexAbs = path.join(root, INDEX_FILE);

  const files = (await listDocs(root)).filter((abs) => !RESERVED_FILES.has(path.basename(abs)));
  const docs: DocEntry[] = [];
  const incomplete: string[] = [];

  for (const abs of files) {
    const data = (matter(await fs.readFile(abs, "utf8")).data ?? {}) as Record<string, unknown>;
    const rel = path.relative(root, abs).split(path.sep).join("/");
    if (!docFrontmatterSchema.safeParse(data).success) incomplete.push(rel);
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

  if (incomplete.length > 0) {
    const shape = ["```markdown", metadataShape(), "```"]
      .join("\n")
      .split("\n")
      .map((line) => ` > ${line}`)
      .join("\n");
    ctx.logger.warn(
      `The following files' metadata is incomplete:\n` +
        incomplete.map((f) => `- ${f}`).join("\n") +
        `\n\nMetadata shape:\n${shape}`,
    );
  }

  return { written, incomplete };
}
