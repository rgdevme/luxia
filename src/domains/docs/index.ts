import fs from "node:fs/promises";
import path from "node:path";
import type { AgnosConfig, Domain } from "../../core/index.js";
import { readConfigOrDefault, writeConfig } from "../../core/index.js";
import { compileDocsIndex, DEFAULT_DOCS_ROOT, INDEX_FILE, LOG_FILE } from "./compile.js";

export * from "./compile.js";

export const docsDomain: Domain = {
  id: "docs",
  description: "Compile a documentation index from docs.root",
  kind: "writer",
  priority: 20,
  color: "cyan",
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
  async run(opts, ctx) {
    const config = await readConfigOrDefault(ctx.configPath);
    // Nothing to do unless a docs root is configured (empty/undefined → skip).
    if (!config.docs?.root) return undefined;
    await ctx.logger.info({
      message: `Compiling docs index from ${config.docs.root}`,
      waitFor: compileDocsIndex(config, ctx),
    });
    return undefined;
  },
  // Watch the docs tree itself; the supervisor ignores the generated index.md
  // and the agent-maintained log.md so those writes don't re-trigger us.
  watchPaths(config, ctx) {
    const root = config.docs?.root;
    return root ? [path.resolve(ctx.projectRoot, root)] : [];
  },
  watchIgnore(config, ctx) {
    const root = config.docs?.root;
    if (!root) return [];
    const base = path.resolve(ctx.projectRoot, root);
    return [path.join(base, INDEX_FILE), path.join(base, LOG_FILE)];
  },
};

export default docsDomain;
