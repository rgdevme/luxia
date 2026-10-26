import fs from "node:fs/promises";
import path from "node:path";
import type { AgnosConfig, Domain } from "../../core/index.js";
import { readConfigOrDefault, writeConfig } from "../../core/index.js";
import { compileDocsIndex, DEFAULT_DOCS_ROOT, INDEX_FILE, LOG_FILE } from "./compile.js";

export * from "./compile.js";

export const docsDomain: Domain = {
  id: "docs",
  description: "Compile a documentation index from docs.dir",
  kind: "writer",
  priority: 20,
  color: "cyan",
  initSteps: [
    {
      id: "directory",
      type: "text",
      message: "Docs directory (relative to project root):",
      default: DEFAULT_DOCS_ROOT,
      async callback(value, ctx) {
        const root = value.trim() || DEFAULT_DOCS_ROOT;
        const config = (await readConfigOrDefault(ctx.configPath)) as AgnosConfig;
        const next: AgnosConfig = { ...config, docs: { ...(config.docs ?? {}), dir: root } };
        if (ctx.dryRun) {
          ctx.logger.info(`would: set docs.dir = ${root}`);
          return;
        }
        await writeConfig(ctx.configPath, next);
        await fs.mkdir(path.resolve(ctx.projectRoot, root), { recursive: true });
        ctx.logger.success(`docs.dir = ${root}`);
      },
    },
  ],
  async run(opts, ctx) {
    const config = await readConfigOrDefault(ctx.configPath);
    // Nothing to do unless a docs root is configured (empty/undefined → skip).
    if (!config.docs?.dir) return undefined;
    await ctx.logger.info({
      message: `Compiling docs index from ${config.docs.dir}`,
      waitFor: compileDocsIndex(config, ctx),
    });
    return undefined;
  },
  // Watch the docs tree itself; the supervisor ignores the generated index.md
  // and the agent-maintained log.md so those writes don't re-trigger us.
  watchPaths(config, ctx) {
    const root = config.docs?.dir;
    return root ? [path.resolve(ctx.projectRoot, root)] : [];
  },
  watchIgnore(config, ctx) {
    const root = config.docs?.dir;
    if (!root) return [];
    const base = path.resolve(ctx.projectRoot, root);
    const configured = (config.docs?.ignore ?? []).map((pattern) => path.join(base, pattern));
    const referenceRoute = path.resolve(
      ctx.projectRoot,
      config.references?.dir ?? ".agnos/references",
    );
    const referenceRelative = path.relative(base, referenceRoute);
    const references =
      referenceRelative === ".." || referenceRelative.startsWith(`..${path.sep}`)
        ? []
        : [referenceRoute];
    return [path.join(base, INDEX_FILE), path.join(base, LOG_FILE), ...configured, ...references];
  },
};

export default docsDomain;
