import { buildPaths } from "../paths.js";
import { readConfig, writeConfig } from "../config.js";
import { loadPlugins } from "../plugin-loader.js";
import { buildResolveContext } from "../context.js";
import { install } from "../orchestrator.js";
import type { Logger, McpDeclaration } from "../types/public.js";

export interface McpOptions {
  cwd: string;
  sub: string | undefined;
  args: string[];
  noInstall: boolean;
  copyOnNoSymlink: boolean;
  logger: Logger;
}

export async function runMcp(opts: McpOptions): Promise<void> {
  const paths = buildPaths(opts.cwd);
  const config = await readConfig(paths.configPath);
  const ctx = await buildResolveContext({ projectRoot: opts.cwd, logger: opts.logger });
  const registry = await loadPlugins({ projectRoot: opts.cwd, logger: opts.logger });

  const domain = registry.domains.get("mcp");
  if (!domain) {
    throw new Error("no mcp domain plugin installed. Run `pnpm add @agnos/domain-mcp`.");
  }

  switch (opts.sub) {
    case "add": {
      const name = opts.args[0];
      if (!name) throw new Error("usage: agnos mcp add <name>");
      const decl = (await domain.plugin.add(name, ctx)) as McpDeclaration;
      const mcp = (config.mcp ?? []).filter((m) => m.name !== decl.name);
      mcp.push(decl);
      config.mcp = mcp;
      await writeConfig(paths.configPath, config);
      opts.logger.success(`added MCP server: ${decl.name}`);
      break;
    }
    case "remove": {
      const name = opts.args[0];
      if (!name) throw new Error("usage: agnos mcp remove <name>");
      await domain.plugin.remove(name, ctx);
      config.mcp = (config.mcp ?? []).filter((m) => m.name !== name);
      await writeConfig(paths.configPath, config);
      opts.logger.success(`removed MCP server: ${name}`);
      break;
    }
    case "update": {
      const name = opts.args[0];
      if (!name) throw new Error("usage: agnos mcp update <name>");
      await domain.plugin.update(name, ctx);
      opts.logger.success(`updated MCP server: ${name}`);
      break;
    }
    case "list":
    case undefined: {
      const items = await domain.plugin.list(ctx);
      for (const item of items) opts.logger.info(JSON.stringify(item));
      return;
    }
    default:
      throw new Error(`unknown mcp subcommand: ${opts.sub}`);
  }

  if (!opts.noInstall && (config.agents?.length ?? 0) > 0) {
    await install(config, registry, ctx, { copyOnNoSymlink: opts.copyOnNoSymlink, interactive: true });
  }
}
