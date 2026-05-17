import { buildPaths } from "../paths.js";
import { readConfig, writeConfig } from "../config.js";
import { loadPlugins } from "../plugin-loader.js";
import { buildResolveContext } from "../context.js";
import { resolveSkill } from "../orchestrator.js";
import {
  activeAgents,
  dispatchSkillAdded,
  dispatchSkillRemoved,
  dispatchSkillUpdated,
} from "../events.js";
import type { Logger, ResolveContext, ResolvedSkill, SkillDeclaration } from "../types/public.js";

export interface SkillOptions {
  cwd: string;
  sub: string | undefined;
  args: string[];
  noInstall: boolean;
  copyOnNoSymlink: boolean;
  dryRun?: boolean;
  logger: Logger;
}

export async function runSkill(opts: SkillOptions): Promise<void> {
  const paths = buildPaths(opts.cwd);
  const config = await readConfig(paths.configPath);
  const ctx = await buildResolveContext({
    projectRoot: opts.cwd,
    logger: opts.logger,
    dryRun: opts.dryRun ?? false,
  });
  const registry = await loadPlugins({ projectRoot: opts.cwd, logger: opts.logger });

  const domain = registry.domains.get("skills");
  if (!domain) {
    throw new Error("no skills domain plugin installed. Run `pnpm add @luxia/domain-skills`.");
  }

  const agents = activeAgents(config, registry, ctx);

  switch (opts.sub) {
    case "add": {
      const ref = opts.args[0];
      if (!ref) throw new Error("usage: agnos skill add <ref>");
      if (!domain.plugin.add) throw new Error("skills domain has no add()");
      if (ctx.dryRun) {
        opts.logger.info(`would: fetch + register skill from ${ref}`);
        break;
      }
      const item = (await domain.plugin.add(ref, ctx)) as ResolvedSkill;
      const decl: SkillDeclaration = { name: item.name, source: ref };
      const skills = (config.skills ?? []).filter((s) => s.name !== decl.name);
      skills.push(decl);
      config.skills = skills;
      await writeConfig(paths.configPath, config);
      opts.logger.success(`added skill: ${decl.name}`);
      if (!opts.noInstall) await dispatchSkillAdded(item, agents, config, ctx);
      break;
    }
    case "remove": {
      const name = opts.args[0];
      if (!name) throw new Error("usage: agnos skill remove <name>");
      if (!domain.plugin.remove) throw new Error("skills domain has no remove()");
      if (ctx.dryRun) {
        opts.logger.info(`would: remove skill ${name}`);
        break;
      }
      await domain.plugin.remove(name, ctx);
      config.skills = (config.skills ?? []).filter((s) => s.name !== name);
      await writeConfig(paths.configPath, config);
      opts.logger.success(`removed skill: ${name}`);
      if (!opts.noInstall) await dispatchSkillRemoved(name, agents, config, ctx);
      break;
    }
    case "update": {
      const name = opts.args[0];
      if (!name) throw new Error("usage: agnos skill update <name>");
      if (!domain.plugin.update) throw new Error("skills domain has no update()");
      if (ctx.dryRun) {
        opts.logger.info(`would: re-fetch skill ${name}`);
        break;
      }
      const item = (await domain.plugin.update(name, ctx)) as ResolvedSkill;
      opts.logger.success(`updated skill: ${name}`);
      if (!opts.noInstall) await dispatchSkillUpdated(item, agents, config, ctx);
      break;
    }
    case "list":
    case undefined: {
      if (!domain.plugin.list) throw new Error("skills domain has no list()");
      const items = await domain.plugin.list(ctx);
      for (const item of items) opts.logger.info(JSON.stringify(item));
      return;
    }
    default:
      throw new Error(`unknown skill subcommand: ${opts.sub}`);
  }
}

export async function resolveSkillByName(
  name: string,
  ctx: ResolveContext,
): Promise<ResolvedSkill> {
  return resolveSkill(name, ctx);
}
