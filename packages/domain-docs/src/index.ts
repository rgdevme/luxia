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
  priority: 40,
  declarationSchema: docsConfigSchema,

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
    if (agnos.rules?.source) {
      const cfg = await readEffectiveDocsConfig(ctx);
      if (cfg.injectIndex || cfg.injectRules) {
        await runInject(cfg, ctx);
      }
    }
  },
};

export default docsPlugin;
