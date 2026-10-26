import fs from "node:fs/promises";
import path from "node:path";
import type { AgnosConfig, Domain } from "../../core/index.js";
import { readConfigOrDefault, writeConfig } from "../../core/index.js";
import { bootstrapRulesCommand } from "./bootstrap.js";
import { generateRules, rulesSourcePaths } from "./generate.js";
import { readDefaultRulesTemplate } from "./template.js";

export { readDefaultRulesTemplate, generateRules, rulesSourcePaths };

const DEFAULT_RULES_DIR = ".agnos/rules";
const DEFAULT_CANONICAL = "./AGENTS.md";

export const rulesDomain: Domain = {
  id: "rules",
  description: "Generate complete rules artifacts from ordered Markdown sources",
  kind: "writer",
  priority: 30,
  color: "green",
  commands: { bootstrap: bootstrapRulesCommand },
  initSteps: [
    {
      id: "directory",
      type: "text",
      message: "Rules source directory path:",
      default: async (ctx) =>
        (await readConfigOrDefault(ctx.configPath)).rules?.dir ?? DEFAULT_RULES_DIR,
      async callback(value, ctx) {
        const directory = value.trim() || DEFAULT_RULES_DIR;
        const config = await readConfigOrDefault(ctx.configPath);
        const next: AgnosConfig = {
          ...config,
          rules: { ...config.rules, dir: directory, fragments: config.rules?.fragments ?? {} },
        };
        if (ctx.dryRun) {
          ctx.logger.info(`would: set rules.dir = ${directory}`);
          return;
        }
        await writeConfig(ctx.configPath, next);
        const rulesDir = path.resolve(ctx.projectRoot, directory);
        await fs.mkdir(rulesDir, { recursive: true });
        const indexPath = path.join(rulesDir, "_index.md");
        if (!(await fs.lstat(indexPath).catch(() => null))) {
          await fs.writeFile(indexPath, await readDefaultRulesTemplate(), "utf8");
        }
      },
    },
    {
      id: "canonical",
      type: "text",
      message: "Generated rules artifact path:",
      default: async (ctx) => {
        const config = await readConfigOrDefault(ctx.configPath);
        return Object.keys(config.rules?.fragments ?? {})[0] ?? DEFAULT_CANONICAL;
      },
      async callback(value, ctx) {
        const canonical = value.trim() || DEFAULT_CANONICAL;
        const config = await readConfigOrDefault(ctx.configPath);
        const fragments = { ...(config.rules?.fragments ?? {}) };
        const rulesDir = config.rules?.dir ?? DEFAULT_RULES_DIR;
        const rulesBase = path.resolve(ctx.projectRoot, rulesDir);
        const docsRoot = path.resolve(ctx.projectRoot, config.docs?.dir ?? ".agnos/docs");
        const docsIndex = path
          .relative(rulesBase, path.join(docsRoot, "index.md"))
          .split(path.sep)
          .join("/");
        fragments[canonical] = [...new Set([...(fragments[canonical] ?? []), ".", docsIndex])];
        const next: AgnosConfig = {
          ...config,
          rules: { ...config.rules, dir: rulesDir, fragments },
        };
        if (ctx.dryRun) {
          ctx.logger.info(`would: generate ${canonical} from rules.dir sources`);
          return;
        }
        await writeConfig(ctx.configPath, next);
      },
    },
  ],
  async run(_opts, ctx) {
    const config = await readConfigOrDefault(ctx.configPath);
    if (Object.keys(config.rules?.fragments ?? {}).length === 0) return undefined;
    await ctx.logger.info({
      message: "Generating rules artifacts",
      waitFor: generateRules(config, ctx),
    });
    return undefined;
  },
  watchPaths(config, ctx) {
    return rulesSourcePaths(config, ctx);
  },
  watchIgnore(config, ctx) {
    return [
      ...Object.keys(config.rules?.fragments ?? {}).map((output) =>
        path.resolve(ctx.projectRoot, output),
      ),
      path.resolve(ctx.projectRoot, config.docs?.dir ?? ".agnos/docs", "index.md"),
    ];
  },
};

export default rulesDomain;
