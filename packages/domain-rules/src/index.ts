import path from "node:path";
import fs from "node:fs/promises";
import type { DomainPlugin, ResolvedRule, RulesDeclaration } from "@luxia/core";
import { readConfigOrDefault, rulesDeclarationSchema, setRulesSource } from "@luxia/core";
import { readDefaultRulesTemplate } from "./template.js";

export { readDefaultRulesTemplate };

const rulesPlugin: DomainPlugin<RulesDeclaration, ResolvedRule> = {
  name: "rules",
  priority: 10,
  declarationSchema: rulesDeclarationSchema,

  initSteps: [
    {
      id: "source",
      type: "text",
      message: "Rules-source path (relative to project root):",
      default: async (ctx) => {
        const cfg = await readConfigOrDefault(ctx.configPath);
        return cfg.rules?.source ?? "./AGENTS.md";
      },
      async callback(value, ctx) {
        await setRulesSource(value, {
          cwd: ctx.projectRoot,
          yes: true,
          dryRun: ctx.dryRun ?? false,
          logger: ctx.logger,
          noDispatch: true,
        });
      },
    },
  ],

  async onInitialize(_ctx) {
    // No work — the initSteps + reinstate pass cover bootstrap.
  },

  async resolve(decl, ctx) {
    const abs = path.resolve(ctx.projectRoot, decl.source);
    await ensureFileExists(abs);
    return { absolutePath: abs, relativeSource: decl.source };
  },

  async move(from, to, ctx) {
    const oldAbs = path.resolve(ctx.projectRoot, from);
    const newAbs = path.resolve(ctx.projectRoot, to);
    if (path.resolve(oldAbs) === path.resolve(newAbs)) return;
    const oldExists = await pathExists(oldAbs);
    const newExists = await pathExists(newAbs);
    if (oldExists && !newExists) {
      await fs.mkdir(path.dirname(newAbs), { recursive: true });
      await fs.rename(oldAbs, newAbs);
    } else if (!oldExists && !newExists) {
      await ensureFileExists(newAbs);
    }
    // both-exist case is handled by the CLI command (user-prompted)
  },

  async list(ctx) {
    const defaultPath = path.resolve(ctx.projectRoot, "./AGENTS.md");
    return [{ absolutePath: defaultPath, relativeSource: "./AGENTS.md" }];
  },
};

async function ensureFileExists(absPath: string): Promise<void> {
  try {
    await fs.access(absPath);
  } catch {
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, await readDefaultRulesTemplate(), "utf8");
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export default rulesPlugin;
