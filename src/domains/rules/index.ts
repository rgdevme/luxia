import path from "node:path";
import type { AgnosConfig, DomainPlugin, ResolvedRule, RulesDeclaration } from "@luxia/core";
import {
  ensureStarterRules,
  readConfigOrDefault,
  resolveRules,
  rulesDeclarationSchema,
  writeConfig,
} from "@luxia/core";
import { readDefaultRulesTemplate } from "./template.js";

export { readDefaultRulesTemplate };

const DEFAULT_RULES: RulesDeclaration = { filename: "AGENTS.md", root: ".", dirs: [] };

async function patchRules(
  patch: Partial<RulesDeclaration>,
  ctx: {
    configPath: string;
    dryRun?: boolean;
  },
): Promise<RulesDeclaration> {
  const config = (await readConfigOrDefault(ctx.configPath)) as AgnosConfig;
  const rules: RulesDeclaration = { ...DEFAULT_RULES, ...(config.rules ?? {}), ...patch };
  if (!ctx.dryRun) await writeConfig(ctx.configPath, { ...config, rules });
  return rules;
}

const rulesPlugin: DomainPlugin<RulesDeclaration, ResolvedRule> = {
  name: "rules",
  priority: 10,
  declarationSchema: rulesDeclarationSchema,

  async getStarterContent() {
    return readDefaultRulesTemplate();
  },

  initSteps: [
    {
      id: "filename",
      type: "text",
      message: "Canonical rule-file name (every agent mirrors this):",
      default: async (ctx) => {
        const cfg = await readConfigOrDefault(ctx.configPath);
        return cfg.rules?.filename ?? DEFAULT_RULES.filename;
      },
      async callback(value, ctx) {
        await patchRules({ filename: value.trim() || DEFAULT_RULES.filename }, ctx);
      },
    },
    {
      id: "root",
      type: "text",
      message: "Rules root directory (relative to project root):",
      default: async (ctx) => {
        const cfg = await readConfigOrDefault(ctx.configPath);
        return cfg.rules?.root ?? DEFAULT_RULES.root;
      },
      async callback(value, ctx) {
        const rules = await patchRules({ root: value.trim() || DEFAULT_RULES.root }, ctx);
        if (ctx.dryRun) return;
        const rootFile = path.resolve(ctx.projectRoot, rules.root, rules.filename);
        const { created } = await ensureStarterRules(rootFile, () => readDefaultRulesTemplate());
        if (created) ctx.logger.success(`created ${path.relative(ctx.projectRoot, rootFile)}`);
      },
    },
  ],

  async onInitialize(_ctx) {
    // The init steps + the reinstate materialization pass cover bootstrap.
  },

  async resolve(decl, ctx) {
    // Single-item resolve returns the root file; the full set comes from `list`.
    const entries = resolveRules(decl, ctx);
    return entries[0]!;
  },

  async list(ctx) {
    const config = await readConfigOrDefault(ctx.configPath);
    return resolveRules(config.rules ?? DEFAULT_RULES, ctx);
  },
};

export default rulesPlugin;
