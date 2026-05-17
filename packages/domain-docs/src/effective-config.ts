import path from "node:path";
import { readConfigOrDefault } from "@luxia/core";
import type { ResolveContext } from "@luxia/core";
import {
  DEFAULTS,
  DEFAULT_DOCS_METADATA,
  docsConfigSchema,
  type DocsConfig,
  type MetadataSchema,
} from "./schema.js";

export interface EffectiveDocsConfig {
  route: string;
  routeRelative: string;
  indexName: string;
  contentName: string | false;
  docRulesName: string;
  injectIndex: boolean;
  injectRules: boolean;
  metadata: MetadataSchema;
  indexFile: string;
  contentFile: string | null;
  docRulesFile: string;
}

export async function readEffectiveDocsConfig(ctx: ResolveContext): Promise<EffectiveDocsConfig> {
  const raw = await readConfigOrDefault(ctx.configPath);
  const parsed: DocsConfig = docsConfigSchema.parse((raw as { docs?: unknown }).docs ?? {});

  const routeRelative = parsed.route ?? DEFAULTS.route;
  const route = path.resolve(ctx.projectRoot, routeRelative);
  const indexName = parsed.index ?? DEFAULTS.indexName;
  const contentName: string | false =
    parsed.content === false ? false : (parsed.content ?? DEFAULTS.contentName);
  const docRulesName = parsed.docRules ?? DEFAULTS.docRulesName;

  return {
    route,
    routeRelative,
    indexName,
    contentName,
    docRulesName,
    injectIndex: parsed.injectIndex ?? DEFAULTS.injectIndex,
    injectRules: parsed.injectRules ?? DEFAULTS.injectRules,
    metadata: parsed.metadata ?? DEFAULT_DOCS_METADATA,
    indexFile: path.join(route, `${indexName}.md`),
    contentFile: contentName === false ? null : path.join(route, `${contentName}.md`),
    docRulesFile: path.join(route, `${docRulesName}.md`),
  };
}

/**
 * Returns the absolute paths of the three init files (excluding content when disabled).
 * Used everywhere that needs to exclude init files from validation, generation, or watching.
 */
export function initFiles(cfg: EffectiveDocsConfig): string[] {
  const out = [cfg.indexFile, cfg.docRulesFile];
  if (cfg.contentFile) out.push(cfg.contentFile);
  return out;
}
