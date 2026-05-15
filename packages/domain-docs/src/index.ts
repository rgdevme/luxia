import type { DomainPlugin, ResolveContext } from "@agnos/core";
import { readConfigOrDefault } from "@agnos/core";
import { docsConfigSchema, type DocsConfig } from "./schema.js";
import { init, runInit } from "./cli/init.js";
import { validate } from "./cli/validate.js";
import { generate } from "./cli/generate.js";
import { inject, runInject } from "./cli/inject.js";
import { watchCmd } from "./cli/watch.js";
import { readEffectiveDocsConfig } from "./effective-config.js";

const docsPlugin: DomainPlugin<DocsConfig, DocsConfig> = {
  name: "docs",
  declarationSchema: docsConfigSchema,

  async resolve(decl) {
    return decl;
  },

  async add() {
    throw new Error("docs has no `add` — use `agnos docs init`.");
  },

  async remove() {
    throw new Error("docs has no `remove` — the directory persists across runs.");
  },

  async update(_name, ctx) {
    const cfg = await readEffectiveDocsConfig(ctx);
    return {
      route: cfg.routeRelative,
      index: cfg.indexName,
      content: cfg.contentName,
      docRules: cfg.docRulesName,
      injectIndex: cfg.injectIndex,
      injectRules: cfg.injectRules,
      metadata: cfg.metadata,
    };
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

  async onInit(ctx: ResolveContext) {
    await runInit(ctx);
    const agnos = await readConfigOrDefault(ctx.configPath);
    if (agnos.rules?.source) {
      const cfg = await readEffectiveDocsConfig(ctx);
      if (cfg.injectIndex || cfg.injectRules) {
        await runInject(cfg, ctx);
      }
    }
  },
};

export default docsPlugin;
