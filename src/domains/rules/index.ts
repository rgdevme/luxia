import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import type { AgnosConfig, Domain, ResolveContext } from "../../core/index.js";
import {
  readConfigOrDefault,
  readState,
  withSpinner,
  writeConfig,
  writeState,
} from "../../core/index.js";
import { injectSections, slugify, type Section } from "./inject.js";
import { readDefaultRulesTemplate } from "./template.js";

export { readDefaultRulesTemplate };
export * from "./inject.js";

const DEFAULT_CANONICAL = "./AGENTS.md";

/**
 * Read an injectable fragment and turn it into a titled section. Returns null
 * (with the missing-property recorded) when the fragment lacks a `title`.
 */
async function loadSection(
  rel: string,
  ctx: ResolveContext,
  missing: string[],
): Promise<Section | null> {
  const abs = path.resolve(ctx.projectRoot, rel);
  let raw: string;
  try {
    raw = await fs.readFile(abs, "utf8");
  } catch {
    ctx.logger.warn(`rules: injectable not found, skipping: ${rel}`);
    return null;
  }
  const parsed = matter(raw);
  const title = typeof parsed.data["title"] === "string" ? parsed.data["title"].trim() : "";
  if (!title) {
    missing.push(rel);
    return null;
  }
  return { slug: slugify(title), title, body: parsed.content };
}

/**
 * Inject each canonical file's fragments as titled sections. Missing/duplicate
 * titles warn and skip (§13.3). Writes only when content changed (idempotent).
 */
export async function injectRules(config: AgnosConfig, ctx: ResolveContext): Promise<void> {
  const files = config.rules?.files ?? {};
  const missingTitle: string[] = [];
  const state = await readState(ctx.statePath);
  const prevSections = state.rulesSections ?? {};
  // Rebuilt fresh each run: only currently-declared canonical files survive, so
  // a file dropped from rules.files is forgotten (its slugs no longer prune).
  const nextSections: Record<string, string[]> = {};

  for (const [canonical, injectables] of Object.entries(files)) {
    const sections: Section[] = [];
    const seen = new Map<string, string>(); // slug → first fragment path
    for (const rel of injectables) {
      const section = await loadSection(rel, ctx, missingTitle);
      if (!section) continue;
      const prior = seen.get(section.slug);
      if (prior) {
        ctx.logger.warn(
          `rules: duplicate title "${section.title}" for ${canonical} (${prior} and ${rel}); skipping ${rel}`,
        );
        continue;
      }
      seen.set(section.slug, rel);
      sections.push(section);
    }

    const canonAbs = path.resolve(ctx.projectRoot, canonical);
    let existing = "";
    try {
      existing = await fs.readFile(canonAbs, "utf8");
    } catch {
      /* new canonical file */
    }
    const prevSlugs = prevSections[canonical] ?? [];
    const next = injectSections(existing, sections, prevSlugs);
    nextSections[canonical] = sections.map((s) => s.slug);
    if (next === existing) continue;
    if (ctx.dryRun) {
      ctx.logger.info(`would: inject ${sections.length} section(s) into ${canonical}`);
      continue;
    }
    await fs.mkdir(path.dirname(canonAbs), { recursive: true });
    await fs.writeFile(canonAbs, next, "utf8");
    ctx.logger.info(`rules: injected ${sections.length} section(s) into ${canonical}`);
  }

  // Persist the managed-slug map so a later run can prune the sections of
  // fragments removed from rules.files in the meantime.
  if (!ctx.dryRun) await writeState(ctx.statePath, { ...state, rulesSections: nextSections });

  if (missingTitle.length > 0) {
    ctx.logger.warn(
      `The following files are missing some metadata properties:\n` +
        `title: short, human-readable section title (used as the injection boundary)\n` +
        missingTitle.map((f) => `- ${f}: title`).join("\n"),
    );
  }
}

export const rulesDomain: Domain = {
  id: "rules",
  description: "Inject titled sections from fragment files into canonical rules files",
  kind: "writer",
  priority: 30,
  initSteps: [
    {
      id: "canonical",
      type: "text",
      message: "Canonical rules file path:",
      default: DEFAULT_CANONICAL,
      async callback(value, ctx) {
        const canonical = value.trim() || DEFAULT_CANONICAL;
        const config = (await readConfigOrDefault(ctx.configPath)) as AgnosConfig;
        const files = { ...(config.rules?.files ?? {}) };
        if (!(canonical in files)) files[canonical] = [];
        const next: AgnosConfig = { ...config, rules: { files } };
        if (ctx.dryRun) {
          ctx.logger.info(`would: seed rules.files["${canonical}"] = []`);
          return;
        }
        await writeConfig(ctx.configPath, next);
        const canonAbs = path.resolve(ctx.projectRoot, canonical);
        try {
          await fs.access(canonAbs);
        } catch {
          await fs.mkdir(path.dirname(canonAbs), { recursive: true });
          await fs.writeFile(canonAbs, await readDefaultRulesTemplate(), "utf8");
          ctx.logger.success(`created ${canonical}`);
        }
      },
    },
  ],
  async run(opts, ctx) {
    const config = await readConfigOrDefault(ctx.configPath);
    // No canonical files declared (empty/undefined `rules.files`) → skip.
    if (Object.keys(config.rules?.files ?? {}).length === 0) return undefined;
    await withSpinner("Injecting rules", () => injectRules(config, ctx), { quiet: opts.quiet });
    return undefined;
  },
  // Watch every injectable fragment declared across all canonical files. Editing
  // a fragment re-injects its titled section into its canonical file(s).
  watchPaths(config, ctx) {
    const files = config.rules?.files ?? {};
    const seen = new Set<string>();
    for (const injectables of Object.values(files)) {
      for (const rel of injectables) seen.add(path.resolve(ctx.projectRoot, rel));
    }
    return [...seen];
  },
};

export default rulesDomain;
