import fs from "node:fs/promises";
import path from "node:path";
import type { CliCommand, ResolveContext } from "@luxia/core";
import { readConfigOrDefault } from "@luxia/core";
import { readEffectiveDocsConfig, type EffectiveDocsConfig } from "../effective-config.js";
import { INDEX_BLOCK, RULES_BLOCK } from "../schema.js";
import { replaceBetweenMarkers, stripFrontmatter } from "../inject/markers.js";

export const inject: CliCommand = {
  description: "Inject doc-rules and index into the project's rules file",
  async run(_args, ctx) {
    const cfg = await readEffectiveDocsConfig(ctx);
    await runInject(cfg, ctx);
  },
};

export async function runInject(
  cfg: EffectiveDocsConfig,
  ctx: ResolveContext,
): Promise<{ changed: boolean }> {
  const agnos = await readConfigOrDefault(ctx.configPath);
  const rulesRel = agnos.rules?.source;
  if (!rulesRel) {
    ctx.logger.debug("no rules source configured in agnos.json — skipping inject");
    return { changed: false };
  }
  const rulesAbs = path.resolve(ctx.projectRoot, rulesRel);
  let text: string;
  try {
    text = await fs.readFile(rulesAbs, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    ctx.logger.debug(
      `rules file ${path.relative(ctx.projectRoot, rulesAbs)} does not exist — skipping inject`,
    );
    return { changed: false };
  }

  // Apply rules block first, then index block.
  if (cfg.injectRules) {
    const payload = await readBodyOrEmpty(cfg.docRulesFile);
    if (payload !== null) {
      const next = replaceBetweenMarkers(text, RULES_BLOCK.start, RULES_BLOCK.end, payload);
      text = next.text;
    }
  }
  if (cfg.injectIndex) {
    const payload = await readBodyOrEmpty(cfg.indexFile);
    if (payload !== null) {
      const next = replaceBetweenMarkers(text, INDEX_BLOCK.start, INDEX_BLOCK.end, payload);
      text = next.text;
    }
  }

  let existing = "";
  try {
    existing = await fs.readFile(rulesAbs, "utf8");
  } catch {
    existing = "";
  }
  if (existing === text) {
    ctx.logger.debug(`  ${path.relative(ctx.projectRoot, rulesAbs)} unchanged`);
    return { changed: false };
  }
  await fs.mkdir(path.dirname(rulesAbs), { recursive: true });
  await fs.writeFile(rulesAbs, text, "utf8");
  ctx.logger.info(`  injected into ${path.relative(ctx.projectRoot, rulesAbs)}`);
  return { changed: true };
}

async function readBodyOrEmpty(file: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(file, "utf8");
    return stripFrontmatter(raw).trimEnd();
  } catch {
    return null;
  }
}
