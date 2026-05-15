import path from "node:path";
import fs from "node:fs/promises";
import type {
  DomainPlugin,
  ResolveContext,
  ResolvedRule,
  RulesDeclaration,
} from "@agnos/core";
import { rulesDeclarationSchema } from "@agnos/core";

const rulesPlugin: DomainPlugin<RulesDeclaration, ResolvedRule> = {
  name: "rules",
  declarationSchema: rulesDeclarationSchema,

  async resolve(decl, ctx) {
    const abs = path.resolve(ctx.projectRoot, decl.source);
    await ensureFileExists(abs);
    return {
      absolutePath: abs,
      relativeSource: decl.source,
    };
  },

  async add() {
    throw new Error("rules has no `add` — use `agnos rules` to set the path.");
  },

  async remove() {
    throw new Error("rules has no `remove` — use `agnos rules` to retarget.");
  },

  async update(_name, ctx) {
    // No-op: the rules file is just a file path; nothing to refetch.
    return {
      absolutePath: path.resolve(ctx.projectRoot, "./AGENTS.md"),
      relativeSource: "./AGENTS.md",
    };
  },

  async list(ctx): Promise<ResolvedRule[]> {
    const defaultPath = path.resolve(ctx.projectRoot, "./AGENTS.md");
    return [{ absolutePath: defaultPath, relativeSource: "./AGENTS.md" }];
  },
};

async function ensureFileExists(absPath: string): Promise<void> {
  try {
    await fs.access(absPath);
  } catch {
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, "# AGENTS.md\n", "utf8");
  }
}

export default rulesPlugin;
