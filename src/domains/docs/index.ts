import fs from "node:fs/promises";
import path from "node:path";
import type { AgnosConfig, Domain } from "../../core/index.js";
import { readConfigOrDefault, writeConfig } from "../../core/index.js";
import { compileDocsIndex, DEFAULT_DOCS_ROOT } from "./compile.js";

export * from "./compile.js";

export const docsDomain: Domain = {
  id: "docs",
  description: "Compile a documentation index from docs.root",
  kind: "writer",
  priority: 20,
  initSteps: [
    {
      id: "root",
      type: "text",
      message: "Docs directory (relative to project root):",
      default: DEFAULT_DOCS_ROOT,
      async callback(value, ctx) {
        const root = value.trim() || DEFAULT_DOCS_ROOT;
        const config = (await readConfigOrDefault(ctx.configPath)) as AgnosConfig;
        const next: AgnosConfig = { ...config, docs: { ...(config.docs ?? {}), root } };
        if (ctx.dryRun) {
          ctx.logger.info(`would: set docs.root = ${root}`);
          return;
        }
        await writeConfig(ctx.configPath, next);
        await fs.mkdir(path.resolve(ctx.projectRoot, root), { recursive: true });
        ctx.logger.success(`docs.root = ${root}`);
      },
    },
  ],
  async run(_opts, ctx) {
    const config = await readConfigOrDefault(ctx.configPath);
    // Nothing to do unless a docs root is configured (empty/undefined → skip).
    if (!config.docs?.root) return undefined;
    await compileDocsIndex(config, ctx);
    return undefined;
  },
};

export default docsDomain;
