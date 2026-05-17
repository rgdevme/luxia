import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import type { CliCommand, ResolveContext } from "@luxia/core";
import { readEffectiveDocsConfig, type EffectiveDocsConfig } from "../effective-config.js";
import { listUserDocs } from "./validate.js";
import {
  CONTENT_VALUES,
  contentTemplate,
  DOC_RULES_VALUES,
  docRulesTemplate,
  INDEX_VALUES,
  indexTemplate,
  renderFrontmatter,
  renderRequiredFields,
  renderTemplate,
} from "../templates.js";

export const generate: CliCommand = {
  description:
    "Regenerate index.md, content.md, and doc-rules.md from agnos.json#docs.metadata and user docs",
  async run(_args, ctx) {
    const cfg = await readEffectiveDocsConfig(ctx);
    await runGenerate(cfg, ctx);
  },
};

export async function runGenerate(
  cfg: EffectiveDocsConfig,
  ctx: ResolveContext,
): Promise<{ indexChanged: boolean; contentChanged: boolean; docRulesChanged: boolean }> {
  const files = await listUserDocs(cfg);
  const docs = await Promise.all(files.map((abs) => readDoc(abs, cfg)));
  docs.sort(compareDocs);

  const indexText = renderTemplate(indexTemplate, {
    frontmatter: renderFrontmatter(cfg, INDEX_VALUES),
    body: renderIndexBody(docs),
  });
  const indexChanged = await writeIfChanged(cfg.indexFile, indexText, ctx);

  let contentChanged = false;
  if (cfg.contentFile) {
    const contentText = renderTemplate(contentTemplate, {
      frontmatter: renderFrontmatter(cfg, CONTENT_VALUES),
      body: renderContentBody(docs),
    });
    contentChanged = await writeIfChanged(cfg.contentFile, contentText, ctx);
  }

  const rulesText = renderTemplate(docRulesTemplate, {
    frontmatter: renderFrontmatter(cfg, DOC_RULES_VALUES),
    required_fields: renderRequiredFields(cfg),
  });
  const docRulesChanged = await writeIfChanged(cfg.docRulesFile, rulesText, ctx);

  return { indexChanged, contentChanged, docRulesChanged };
}

interface DocEntry {
  absolutePath: string;
  relativeFromRoute: string;
  topDir: string;
  title: string;
  description: string;
  body: string;
}

async function readDoc(abs: string, cfg: EffectiveDocsConfig): Promise<DocEntry> {
  const raw = await fs.readFile(abs, "utf8");
  const parsed = matter(raw);
  const data = (parsed.data ?? {}) as Record<string, unknown>;
  const relativeFromRoute = path.relative(cfg.route, abs).split(path.sep).join("/");
  const segments = relativeFromRoute.split("/");
  const topDir = segments.length > 1 ? segments[0]! : "";
  return {
    absolutePath: abs,
    relativeFromRoute,
    topDir,
    title: typeof data["title"] === "string" ? data["title"] : path.basename(abs, ".md"),
    description: typeof data["description"] === "string" ? data["description"] : "",
    body: parsed.content.trim(),
  };
}

function compareDocs(a: DocEntry, b: DocEntry): number {
  if (a.topDir === b.topDir) return a.relativeFromRoute.localeCompare(b.relativeFromRoute);
  if (a.topDir === "") return -1;
  if (b.topDir === "") return 1;
  return a.topDir.localeCompare(b.topDir);
}

function renderIndexBody(docs: DocEntry[]): string {
  if (docs.length === 0) {
    return "_No documentation yet. Add markdown files under this directory and run `agnos docs generate`._";
  }
  const grouped = new Map<string, DocEntry[]>();
  for (const d of docs) {
    const sectionKey = d.topDir === "" ? "Overview" : capitalizeSection(d.topDir);
    const arr = grouped.get(sectionKey) ?? [];
    arr.push(d);
    grouped.set(sectionKey, arr);
  }
  const sectionOrder = [...grouped.keys()].sort((a, b) => {
    if (a === "Overview") return -1;
    if (b === "Overview") return 1;
    return a.localeCompare(b);
  });
  const lines: string[] = [];
  for (const section of sectionOrder) {
    lines.push(`## ${section}`);
    for (const d of grouped.get(section) ?? []) {
      const desc = d.description ? `: ${d.description}` : "";
      lines.push(`- [${d.title}](${d.relativeFromRoute})${desc}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

function renderContentBody(docs: DocEntry[]): string {
  if (docs.length === 0) return "";
  const lines: string[] = [];
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i]!;
    if (i > 0) {
      lines.push("");
      lines.push("---");
      lines.push("");
    }
    lines.push(`# ${d.title}`);
    lines.push(`_Source: ${d.relativeFromRoute}_`);
    lines.push("");
    lines.push(d.body);
  }
  return lines.join("\n");
}

function capitalizeSection(dir: string): string {
  return dir
    .split(/[-_]/g)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");
}

async function writeIfChanged(file: string, text: string, ctx: ResolveContext): Promise<boolean> {
  let existing: string | null = null;
  try {
    existing = await fs.readFile(file, "utf8");
  } catch {
    existing = null;
  }
  if (existing === text) return false;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text, "utf8");
  ctx.logger.info(`  wrote ${path.relative(ctx.projectRoot, file)}`);
  return true;
}
