import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { fromMarkdown } from "mdast-util-from-markdown";
import type { AgnosConfig, ResolveContext } from "../../core/index.js";
import {
  hasGlobPattern,
  matchesRelativePatterns,
  normalizeRelativePath,
  relativePosix,
  walkEntries,
} from "../../core/glob.js";

interface SourceFile {
  absolutePath: string;
  relativePath: string;
}

function resolveRulesBase(config: AgnosConfig, projectRoot: string): string {
  const directory = config.rules?.dir ?? ".agnos/rules";
  return path.isAbsolute(directory)
    ? path.resolve(directory)
    : path.resolve(projectRoot, directory);
}

function resolveGlobSearchRoot(declared: string, base: string): string {
  const segments: string[] = [];
  for (const segment of normalizeRelativePath(declared).split("/")) {
    if (hasGlobPattern(segment)) break;
    segments.push(segment);
  }
  return path.resolve(base, ...segments);
}

async function listMarkdownFiles(root: string, ctx: ResolveContext): Promise<SourceFile[]> {
  return (await walkEntries(root))
    .filter((entry) => entry.kind === "file" && entry.absolutePath.endsWith(".md"))
    .map((entry) => ({
      absolutePath: entry.absolutePath,
      relativePath: relativePosix(ctx.projectRoot, entry.absolutePath),
    }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function resolveSources(
  declarations: string[],
  base: string,
  output: string,
  ctx: ResolveContext,
): Promise<SourceFile[]> {
  const files: SourceFile[] = [];
  for (const declared of declarations) {
    const absolutePath = path.resolve(base, declared);
    const stat = await fs.stat(absolutePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" && hasGlobPattern(declared)) return null;
      if (error.code === "ENOENT") throw new Error(`rule source does not exist: ${declared}`);
      throw error;
    });
    if (stat?.isFile()) {
      if (path.resolve(absolutePath) === path.resolve(output)) {
        throw new Error(`rules output cannot also be an input: ${declared}`);
      }
      if (!absolutePath.endsWith(".md")) {
        throw new Error(`rule source must be a Markdown file: ${declared}`);
      }
      files.push({ absolutePath, relativePath: relativePosix(ctx.projectRoot, absolutePath) });
      continue;
    }
    if (stat?.isDirectory()) {
      files.push(...(await listMarkdownFiles(absolutePath, ctx)));
      continue;
    }
    if (!hasGlobPattern(declared)) continue;

    const matches: SourceFile[] = [];
    for (const entry of await walkEntries(resolveGlobSearchRoot(declared, base))) {
      if (path.resolve(entry.absolutePath) === path.resolve(output)) continue;
      const relative = relativePosix(base, entry.absolutePath);
      if (!matchesRelativePatterns(relative, [declared])) continue;
      if (entry.kind === "file" && entry.absolutePath.endsWith(".md")) {
        matches.push({
          absolutePath: entry.absolutePath,
          relativePath: relativePosix(ctx.projectRoot, entry.absolutePath),
        });
      } else if (entry.kind === "directory") {
        matches.push(...(await listMarkdownFiles(entry.absolutePath, ctx)));
      }
    }
    if (matches.length === 0) {
      ctx.logger.warn({
        message: "rule source pattern matched no files, skipping",
        status: declared,
      });
    }
    files.push(...matches);
  }
  const unique = [
    ...new Map(files.map((file) => [path.resolve(file.absolutePath), file])).values(),
  ];
  for (const file of unique) {
    if (path.resolve(file.absolutePath) === path.resolve(output)) {
      throw new Error(`rules output cannot also be an input: ${file.relativePath}`);
    }
  }
  return unique;
}

function findH1Count(markdown: string): number {
  const tree = fromMarkdown(markdown);
  const countHeadings = (nodes: typeof tree.children): number =>
    nodes.reduce((count, node) => {
      const self = node.type === "heading" && node.depth === 1 ? 1 : 0;
      return (
        count +
        self +
        ("children" in node && Array.isArray(node.children) ? countHeadings(node.children) : 0)
      );
    }, 0);
  return countHeadings(tree.children);
}

async function buildArtifact(
  canonical: string,
  declarations: string[],
  base: string,
  ctx: ResolveContext,
): Promise<string> {
  const output = path.resolve(ctx.projectRoot, canonical);
  const inputs = await resolveSources(declarations, base, output, ctx);
  const indexPath = path.resolve(base, "_index.md");
  const indexExists = await fs
    .stat(indexPath)
    .then((stat) => stat.isFile())
    .catch(() => false);
  const explicitlySelectedIndex = declarations.some(
    (declaration) => !hasGlobPattern(declaration) && path.resolve(base, declaration) === indexPath,
  );
  const ordered = [...inputs];
  if (indexExists && !explicitlySelectedIndex) {
    const index = {
      absolutePath: indexPath,
      relativePath: relativePosix(ctx.projectRoot, indexPath),
    };
    ordered.unshift(index);
  }
  const unique = [
    ...new Map(ordered.map((file) => [path.resolve(file.absolutePath), file])).values(),
  ];
  const bodies: string[] = [];
  for (const file of unique) {
    const raw = await fs.readFile(file.absolutePath, "utf8");
    const body = matter(raw).content.trim();
    const h1Count = findH1Count(body);
    const isRootIndex = path.resolve(file.absolutePath) === indexPath;
    if (isRootIndex && h1Count > 1)
      throw new Error(`${file.relativePath} may contain at most one H1 heading`);
    if (!isRootIndex && h1Count > 0)
      throw new Error(
        `${file.relativePath} contains an H1 heading; only rules.dir/_index.md may contain one`,
      );
    if (body) bodies.push(body);
  }
  const content = bodies.length > 0 ? `${bodies.join("\n\n")}\n` : "";
  const outputInputs = unique.filter((file) => path.resolve(file.absolutePath) === output);
  if (outputInputs.length > 0)
    throw new Error(`rules output cannot also be an input: ${canonical}`);
  return content;
}

async function publishArtifact(output: string, content: string): Promise<boolean> {
  const existing = await fs.readFile(output, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (existing === content) return false;
  await fs.mkdir(path.dirname(output), { recursive: true });
  const temporary = `${output}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, content, "utf8");
    await fs.rename(temporary, output);
  } finally {
    await fs.rm(temporary, { force: true });
  }
  return true;
}

export async function generateRules(config: AgnosConfig, ctx: ResolveContext): Promise<void> {
  const fragments = config.rules?.fragments ?? {};
  const base = resolveRulesBase(config, ctx.projectRoot);
  const failures: Error[] = [];
  for (const [canonical, declarations] of Object.entries(fragments)) {
    const output = path.resolve(ctx.projectRoot, canonical);
    try {
      const content = await buildArtifact(canonical, declarations, base, ctx);
      if (ctx.dryRun) {
        ctx.logger.info(`would: generate ${canonical}`);
        continue;
      }
      if (await publishArtifact(output, content)) ctx.logger.success(`generated ${canonical}`);
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      failures.push(failure);
      ctx.logger.error(`failed to generate ${canonical}: ${failure.message}`);
    }
  }
  if (failures.length > 0)
    throw new AggregateError(failures, "one or more rules artifacts failed to generate");
}

export function rulesSourcePaths(config: AgnosConfig, ctx: ResolveContext): string[] {
  const base = resolveRulesBase(config, ctx.projectRoot);
  const paths = new Set([path.resolve(base, "_index.md")]);
  for (const declarations of Object.values(config.rules?.fragments ?? {})) {
    for (const declaration of declarations)
      paths.add(
        hasGlobPattern(declaration)
          ? resolveGlobSearchRoot(declaration, base)
          : path.resolve(base, declaration),
      );
  }
  return [...paths];
}
