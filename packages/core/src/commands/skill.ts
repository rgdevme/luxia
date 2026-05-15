import { buildPaths } from "../paths.js";
import { readConfig, writeConfig } from "../config.js";
import { loadPlugins } from "../plugin-loader.js";
import { buildResolveContext } from "../context.js";
import { install } from "../orchestrator.js";
import type { Logger, SkillDeclaration } from "../types/public.js";

export interface SkillOptions {
  cwd: string;
  sub: string | undefined;
  args: string[];
  noInstall: boolean;
  copyOnNoSymlink: boolean;
  logger: Logger;
}

export async function runSkill(opts: SkillOptions): Promise<void> {
  const paths = buildPaths(opts.cwd);
  const config = await readConfig(paths.configPath);
  const ctx = await buildResolveContext({ projectRoot: opts.cwd, logger: opts.logger });
  const registry = await loadPlugins({ projectRoot: opts.cwd, logger: opts.logger });

  const domain = registry.domains.get("skills");
  if (!domain) {
    throw new Error(
      "no skills domain plugin installed. Run `pnpm add @agnos/domain-skills`.",
    );
  }

  switch (opts.sub) {
    case "add": {
      const ref = opts.args[0];
      if (!ref) throw new Error("usage: agnos skill add <ref>");
      const decl = (await domain.plugin.add(ref, ctx)) as SkillDeclaration;
      const skills = (config.skills ?? []).filter((s) => s.name !== decl.name);
      skills.push(decl);
      config.skills = skills;
      await writeConfig(paths.configPath, config);
      opts.logger.success(`added skill: ${decl.name}`);
      break;
    }
    case "remove": {
      const name = opts.args[0];
      if (!name) throw new Error("usage: agnos skill remove <name>");
      await domain.plugin.remove(name, ctx);
      config.skills = (config.skills ?? []).filter((s) => s.name !== name);
      await writeConfig(paths.configPath, config);
      opts.logger.success(`removed skill: ${name}`);
      break;
    }
    case "update": {
      const name = opts.args[0];
      if (!name) throw new Error("usage: agnos skill update <name>");
      await domain.plugin.update(name, ctx);
      opts.logger.success(`updated skill: ${name}`);
      break;
    }
    case "list":
    case undefined: {
      const items = await domain.plugin.list(ctx);
      for (const item of items) opts.logger.info(JSON.stringify(item));
      return;
    }
    default:
      throw new Error(`unknown skill subcommand: ${opts.sub}`);
  }

  if (!opts.noInstall && (config.agents?.length ?? 0) > 0) {
    await install(config, registry, ctx, { copyOnNoSymlink: opts.copyOnNoSymlink, interactive: true });
  }
}
