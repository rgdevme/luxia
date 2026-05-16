import fs from "node:fs/promises";
import path from "node:path";
import type {
  DomainPlugin,
  ResolvedSkill,
  SkillDeclaration,
} from "@agnos/core";
import { skillDeclarationSchema, buildPaths, readConfigOrDefault } from "@agnos/core";

const skillsPlugin: DomainPlugin<SkillDeclaration, ResolvedSkill> = {
  name: "skills",
  priority: 30,
  declarationSchema: skillDeclarationSchema,

  async onInitialize(ctx) {
    await fs.mkdir(buildPaths(ctx.projectRoot).skillsDir, { recursive: true });
  },

  async resolve(decl, ctx) {
    const targetDir = path.join(buildPaths(ctx.projectRoot).skillsDir, decl.name);
    const skillFile = path.join(targetDir, "SKILL.md");
    let needsFetch = true;
    try {
      await fs.access(skillFile);
      needsFetch = false;
    } catch {
      // fall through
    }
    if (needsFetch) {
      await fs.mkdir(targetDir, { recursive: true });
      await ctx.fetcher.resolve(decl.source, targetDir);
      if (!(await fileExists(skillFile))) {
        ctx.logger.warn(
          `skill "${decl.name}" resolved from ${decl.source} but contains no SKILL.md — agents may not pick it up`,
        );
      }
    }
    return { name: decl.name, absolutePath: targetDir };
  },

  async add(ref, ctx) {
    const name = deriveNameFromRef(ref);
    const targetDir = path.join(buildPaths(ctx.projectRoot).skillsDir, name);
    await fs.mkdir(targetDir, { recursive: true });
    await ctx.fetcher.resolve(ref, targetDir);
    return { name, absolutePath: targetDir };
  },

  async remove(name, ctx) {
    const targetDir = path.join(buildPaths(ctx.projectRoot).skillsDir, name);
    await fs.rm(targetDir, { recursive: true, force: true });
  },

  async update(name, ctx) {
    const config = await readConfigOrDefault(ctx.configPath);
    const decl = (config.skills ?? []).find((s) => s.name === name);
    if (!decl) throw new Error(`skill "${name}" is not declared in agnos.json`);
    const targetDir = path.join(buildPaths(ctx.projectRoot).skillsDir, name);
    await fs.rm(targetDir, { recursive: true, force: true });
    await fs.mkdir(targetDir, { recursive: true });
    await ctx.fetcher.resolve(decl.source, targetDir, { noCache: true });
    return { name, absolutePath: targetDir };
  },

  async list(ctx) {
    const skillsDir = buildPaths(ctx.projectRoot).skillsDir;
    let names: string[] = [];
    try {
      names = await fs.readdir(skillsDir);
    } catch {
      return [];
    }
    return names.map((name) => ({ name, absolutePath: path.join(skillsDir, name) }));
  },
};

export function deriveSkillNameFromRef(ref: string): string {
  return deriveNameFromRef(ref);
}

function deriveNameFromRef(ref: string): string {
  const colonIdx = ref.indexOf(":");
  const after = colonIdx >= 0 ? ref.slice(colonIdx + 1) : ref;
  const noQuery = after.split(/[?#@]/)[0] ?? after;
  const segments = noQuery.split(/[\\/]/).filter(Boolean);
  const last = segments[segments.length - 1];
  if (!last) throw new Error(`Cannot derive skill name from ref: ${ref}`);
  return last.replace(/^@/, "");
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export default skillsPlugin;
