import fs from "node:fs/promises";
import path from "node:path";
import type { DomainPlugin, ResolvedSkill } from "@luxia/core";
import { buildPaths, readConfigOrDefault } from "@luxia/core";
import { z } from "zod";

export { findSkillsInRepo } from "@luxia/core";
export type { DiscoveredSkill } from "@luxia/core";

/**
 * Per-skill declaration shape passed to plugin hooks. `agnos.json#skills` is a
 * record `{ name: source }`; the orchestrator splays each entry into this
 * `{ name, source }` shape for the domain's `resolve()` call.
 */
const declarationSchema = z.object({
  name: z.string().min(1),
  source: z.string().min(1),
});

const skillsPlugin: DomainPlugin<{ name: string; source: string }, ResolvedSkill> = {
  name: "skills",
  priority: 30,
  declarationSchema,

  async onInitialize(ctx) {
    const config = await readConfigOrDefault(ctx.configPath);
    await fs.mkdir(buildPaths(ctx.projectRoot, config).skillsDir, { recursive: true });
  },

  /**
   * Canonical materialization happens in core's `prepareSkills`, called from
   * `reinstate()` *before* the orchestrator runs domain/agent hooks. By the
   * time this resolver fires (if at all — it's not called from the install
   * path any more), the canonical bytes are already on disk.
   */
  async resolve(decl, ctx) {
    const config = await readConfigOrDefault(ctx.configPath);
    const targetDir = path.join(buildPaths(ctx.projectRoot, config).skillsDir, decl.name);
    return { name: decl.name, absolutePath: targetDir };
  },

  async remove(name, ctx) {
    const config = await readConfigOrDefault(ctx.configPath);
    const targetDir = path.join(buildPaths(ctx.projectRoot, config).skillsDir, name);
    await fs.rm(targetDir, { recursive: true, force: true });
  },

  async list(ctx) {
    const config = await readConfigOrDefault(ctx.configPath);
    const skillsDir = buildPaths(ctx.projectRoot, config).skillsDir;
    let names: string[] = [];
    try {
      names = await fs.readdir(skillsDir);
    } catch {
      return [];
    }
    return names.map((name) => ({ name, absolutePath: path.join(skillsDir, name) }));
  },
};

export default skillsPlugin;
