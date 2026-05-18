import fs from "node:fs/promises";
import path from "node:path";
import type { AgentPlugin, DomainPlugin, ResolvedSkill, SkillDeclaration } from "@luxia/core";
import { buildPaths, ensureLink, readConfigOrDefault, skillDeclarationSchema } from "@luxia/core";

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

  /**
   * Bootstrap a per-agent skills directory: link `<projectRoot>/<paths.skillsDir>`
   * to the canonical `.agnos/skills/` so the agent automatically gets every
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

    const linkPath = path.resolve(ctx.projectRoot, rel);
    const canonical = buildPaths(ctx.projectRoot).skillsDir;
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
