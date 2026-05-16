import fs from "node:fs/promises";
import path from "node:path";
import type { AgnosConfig, CliCommand, ResolveContext } from "@agnos/core";
import { readConfigOrDefault, writeConfig } from "@agnos/core";
import { readEffectiveDocsConfig } from "../effective-config.js";
import { DEFAULT_DOCS_METADATA } from "../schema.js";
import { starterContent, starterDocRules, starterIndex } from "../starters.js";

export const init: CliCommand = {
  description: "Create the docs directory and its three initial files",
  async run(_args, ctx) {
    await runInit(ctx);
  },
};

export async function runInit(ctx: ResolveContext): Promise<void> {
  const cfg = await readEffectiveDocsConfig(ctx);
  await fs.mkdir(cfg.route, { recursive: true });

  const writes: Array<[string, string, string]> = [
    [cfg.indexFile, starterIndex(), `${cfg.indexName}.md`],
    [cfg.docRulesFile, starterDocRules(), `${cfg.docRulesName}.md`],
  ];
  if (cfg.contentFile) writes.push([cfg.contentFile, starterContent(), `${cfg.contentName as string}.md`]);

  for (const [filePath, body, label] of writes) {
    if (await exists(filePath)) {
      ctx.logger.debug(`docs init: ${label} already exists, skipping`);
      continue;
    }
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, body, "utf8");
    ctx.logger.info(`created ${path.relative(ctx.projectRoot, filePath)}`);
  }

  await seedDefaultMetadata(ctx);
}

/**
 * Write the default metadata schema into `agnos.json#docs.metadata` if the user
 * hasn't set it. Makes the schema discoverable and editable from the config file.
 * Idempotent: skips when `metadata` is already present.
 */
async function seedDefaultMetadata(ctx: ResolveContext): Promise<void> {
  const config = (await readConfigOrDefault(ctx.configPath)) as AgnosConfig;
  const docsBlock = (config.docs ?? {}) as Record<string, unknown>;
  if (docsBlock["metadata"]) return;

  if (ctx.dryRun) {
    ctx.logger.info(`would: seed default docs.metadata into agnos.json`);
    return;
  }

  const next: AgnosConfig = {
    ...config,
    docs: { ...docsBlock, metadata: DEFAULT_DOCS_METADATA },
  };
  await writeConfig(ctx.configPath, next);
  ctx.logger.info(`seeded default docs.metadata into agnos.json`);
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
