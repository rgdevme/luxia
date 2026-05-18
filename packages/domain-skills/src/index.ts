import fs from "node:fs/promises";
import path from "node:path";
import type { AgentPlugin, DomainPlugin, ResolvedSkill } from "@luxia/core";
import { buildPaths, ensureLink, readConfigOrDefault } from "@luxia/core";
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

  /**
   * Bootstrap a per-agent skills directory: link `<projectRoot>/<paths.skillsDir>`
   * to the canonical skills dir (default `.agnos/skills/`, overridable via
   * `agnos.json#paths.skillsDir`) so the agent automatically gets every
   * current and future skill via a single directory-level symlink.
   *
   * No-op when:
   *  - the agent does not declare `paths.skillsDir` (opted out), or
   *  - the agent defines its own `handles.skills` handlers (custom strategy).
   *
   * Dedupe: if the same `linkPath` is shared by multiple active agents,
   * `ensureLink` is idempotent — the second call returns "already-linked".
   */
  async onAgentActivate(agent, _activeAgents, ctx) {
    const rel = agent.paths?.skillsDir;
    if (!rel) return;
    if (agent.handles?.skills) return;

    const config = await readConfigOrDefault(ctx.configPath);
    const linkPath = path.resolve(ctx.projectRoot, rel);
    const canonical = buildPaths(ctx.projectRoot, config).skillsDir;
    await fs.mkdir(canonical, { recursive: true });

    if (await tryMigrateLegacyDir(linkPath, canonical)) {
      ctx.logger.info(`migrated legacy ${rel} to a directory-level symlink`);
    }

    try {
      const result = await ensureLink(canonical, linkPath, ctx.linker, { fallback: "copy" });
      if (result.kind !== "already-linked") {
        ctx.logger.info(`${rel} → ${path.relative(ctx.projectRoot, canonical)}`);
      }
    } catch (err) {
      ctx.logger.warn(
        `skills: could not link ${rel}: ${(err as Error).message}; ` +
          `move or delete that path and rerun \`agnos install\``,
      );
    }
  },

  /**
   * Cleanup a per-agent skills directory iff no remaining active agent
   * declares the same path. Honors the escape hatch: agents with their own
   * `handles.skills` handle their own cleanup.
   */
  async onAgentDeactivate(agent, remainingAgents, ctx) {
    const rel = agent.paths?.skillsDir;
    if (!rel) return;
    if (agent.handles?.skills) return;

    const linkPath = path.resolve(ctx.projectRoot, rel);
    const stillUsed = findAgentsUsingSkillsDir(linkPath, remainingAgents, ctx.projectRoot);
    if (stillUsed.length > 0) return;

    try {
      await ctx.linker.unlink(linkPath);
      ctx.logger.info(`removed ${rel}`);
    } catch {
      // best-effort
    }
  },
};

/**
 * Returns the active agents whose `paths.skillsDir` resolves to the given
 * absolute path. Used by `onAgentDeactivate` for dedup, exported for tests.
 */
export function findAgentsUsingSkillsDir(
  absSkillsDir: string,
  agents: readonly AgentPlugin[],
  projectRoot: string,
): AgentPlugin[] {
  const norm = path.resolve(absSkillsDir);
  return agents.filter((a) => {
    const rel = a.paths?.skillsDir;
    if (!rel) return false;
    return path.resolve(projectRoot, rel) === norm;
  });
}

/**
 * Legacy layout (pre-refactor): agent created `<linkPath>/` as a real
 * directory and populated it with per-skill junctions pointing into
 * `.agnos/skills/`. If we detect that exact shape — a directory whose
 * immediate children are all symlinks pointing under the canonical skills
 * dir — it's safe to remove and replace with a single directory-level link.
 *
 * Returns true if a migration was performed.
 */
async function tryMigrateLegacyDir(linkPath: string, canonical: string): Promise<boolean> {
  const lstat = await fs.lstat(linkPath).catch(() => null);
  if (!lstat || !lstat.isDirectory() || lstat.isSymbolicLink()) return false;

  let entries: string[];
  try {
    entries = await fs.readdir(linkPath);
  } catch {
    return false;
  }

  const canonicalResolved = path.resolve(canonical);
  for (const name of entries) {
    const child = path.join(linkPath, name);
    const childStat = await fs.lstat(child).catch(() => null);
    if (!childStat?.isSymbolicLink()) return false;
    let realTarget = "";
    try {
      realTarget = await fs.realpath(child);
    } catch {
      return false;
    }
    const parent = path.resolve(path.dirname(realTarget));
    if (parent !== canonicalResolved) return false;
  }

  await fs.rm(linkPath, { recursive: true, force: true });
  return true;
}

export default skillsPlugin;
