import fs from "node:fs/promises";
import path from "node:path";
import type { AgnosConfig, DomainPlugin, ResolveContext } from "../../core/index.js";
import { readConfigOrDefault, writeConfig } from "../../core/index.js";
import { DEFAULTS, docsConfigSchema, type DocsConfig } from "./schema.js";
import { init, runInit } from "./cli/init.js";
import { validate } from "./cli/validate.js";
import { generate } from "./cli/generate.js";
import { inject, runInject } from "./cli/inject.js";
import { watchCmd } from "./cli/watch.js";
import { readEffectiveDocsConfig } from "./effective-config.js";

async function patchDocs(patch: Partial<DocsConfig>, ctx: ResolveContext): Promise<void> {
  const config = (await readConfigOrDefault(ctx.configPath)) as AgnosConfig;
  const existing = ((config.docs as DocsConfig | undefined) ?? {}) as DocsConfig;
  const merged: DocsConfig = { ...existing, ...patch };
  if (ctx.dryRun) return;
  await writeConfig(ctx.configPath, { ...config, docs: merged });
}

/**
 * True when agnos manages a rules file AND that file exists on disk. Used by
 * the inject-related init steps and by `runInject` to short-circuit when
 * there's no rules file to inject into.
 */
async function hasManagedRulesFile(ctx: ResolveContext): Promise<boolean> {
  const cfg = await readConfigOrDefault(ctx.configPath);
  const rules = cfg.rules;
  if (!rules) return false;
  const abs = path.resolve(ctx.projectRoot, rules.root, rules.filename);
  try {
    await fs.access(abs);
    return true;
  } catch {
    return false;
  }
}

const docsPlugin: DomainPlugin<DocsConfig, DocsConfig> = {
  name: "docs",
  priority: 40,
  declarationSchema: docsConfigSchema,

  initSteps: [
    {
      id: "route",
      type: "text",
      message: "Docs directory route (relative to project root):",
      default: async (ctx) => {
        const cfg = await readConfigOrDefault(ctx.configPath);
        return ((cfg.docs as DocsConfig | undefined)?.route ?? DEFAULTS.route) as string;
      },
      async callback(value, ctx) {
        await patchDocs({ route: value }, ctx);
      },
    },
    {
      id: "index",
      type: "text",
      message: "Index filename (without .md):",
      default: async (ctx) => {
        const cfg = await readConfigOrDefault(ctx.configPath);
        return ((cfg.docs as DocsConfig | undefined)?.index ?? DEFAULTS.indexName) as string;
      },
      async callback(value, ctx) {
        await patchDocs({ index: value }, ctx);
      },
    },
    {
      id: "content",
      type: "boolean",
      message: "Generate content.md?",
      default: async (ctx) => {
        const cfg = await readConfigOrDefault(ctx.configPath);
        const v = (cfg.docs as DocsConfig | undefined)?.content;
        return v === false ? false : true;
      },
      async callback(value, ctx) {
        await patchDocs({ content: value ? DEFAULTS.contentName : false }, ctx);
      },
    },
    {
      id: "docRules",
      type: "text",
      message: "Doc-rules filename (without .md):",
      default: async (ctx) => {
        const cfg = await readConfigOrDefault(ctx.configPath);
        return ((cfg.docs as DocsConfig | undefined)?.docRules ?? DEFAULTS.docRulesName) as string;
      },
      async callback(value, ctx) {
        await patchDocs({ docRules: value }, ctx);
      },
    },
    {
      id: "injectIndex",
      type: "boolean",
      message: "Inject the docs index into the rules file?",
      when: (ctx) => hasManagedRulesFile(ctx),
      default: async (ctx) => {
        const cfg = await readConfigOrDefault(ctx.configPath);
        return (cfg.docs as DocsConfig | undefined)?.injectIndex ?? DEFAULTS.injectIndex;
      },
      async callback(value, ctx) {
        await patchDocs({ injectIndex: value }, ctx);
      },
    },
    {
      id: "injectRules",
      type: "boolean",
      message: "Inject doc-rules into the rules file?",
      when: (ctx) => hasManagedRulesFile(ctx),
      default: async (ctx) => {
        const cfg = await readConfigOrDefault(ctx.configPath);
        return (cfg.docs as DocsConfig | undefined)?.injectRules ?? DEFAULTS.injectRules;
      },
      async callback(value, ctx) {
        await patchDocs({ injectRules: value }, ctx);
      },
    },
  ],

  async resolve(decl) {
    return decl;
  },

  async list(ctx) {
    const raw = await readConfigOrDefault(ctx.configPath);
    const block = (raw as { docs?: unknown }).docs;
    return block === undefined ? [] : [docsConfigSchema.parse(block)];
  },

  cli: {
    default: watchCmd,
    init,
    validate,
    inject,
    generate,
    watch: watchCmd,
  },

  async onInitialize(ctx: ResolveContext) {
    await runInit(ctx);
    const agnos = await readConfigOrDefault(ctx.configPath);
    if (agnos.rules) {
      const cfg = await readEffectiveDocsConfig(ctx);
      if (cfg.injectIndex || cfg.injectRules) {
        await runInject(cfg, ctx);
      }
    }
  },
};

export default docsPlugin;
