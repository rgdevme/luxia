import { buildPaths } from "../paths.js";
import { readConfig, writeConfig } from "../config.js";
import { loadPlugins } from "../plugin-loader.js";
import { buildResolveContext } from "../context.js";
import { activeAgents, dispatchMcpAdded, dispatchMcpRemoved, dispatchMcpUpdated } from "../events.js";
import type { Logger, McpDeclaration, ResolvedMcp } from "../types/public.js";

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

  const agents = activeAgents(config, registry, ctx);

  switch (opts.sub) {
    case "add": {
      const name = opts.args[0];
      if (!name) throw new Error("usage: agnos mcp add <name>");
      if (!domain.plugin.add) throw new Error("mcp domain has no add()");
      const item = (await domain.plugin.add(name, ctx)) as ResolvedMcp;
      const decl: McpDeclaration = { ...item };
      const mcp = (config.mcp ?? []).filter((m) => m.name !== decl.name);
      mcp.push(decl);
      config.mcp = mcp;
      await writeConfig(paths.configPath, config);
      opts.logger.success(`added MCP server: ${decl.name}`);
      if (!opts.noInstall) await dispatchMcpAdded(item, agents, ctx);
      break;
    }
    case "remove": {
      const name = opts.args[0];
      if (!name) throw new Error("usage: agnos mcp remove <name>");
      if (!domain.plugin.remove) throw new Error("mcp domain has no remove()");
      await domain.plugin.remove(name, ctx);
      config.mcp = (config.mcp ?? []).filter((m) => m.name !== name);
      await writeConfig(paths.configPath, config);
      opts.logger.success(`removed MCP server: ${name}`);
      if (!opts.noInstall) await dispatchMcpRemoved(name, agents, ctx);
      break;
    }
    case "update": {
      const name = opts.args[0];
      if (!name) throw new Error("usage: agnos mcp update <name>");
      if (!domain.plugin.update) throw new Error("mcp domain has no update()");
      const item = (await domain.plugin.update(name, ctx)) as ResolvedMcp;
      opts.logger.success(`updated MCP server: ${name}`);
      if (!opts.noInstall) await dispatchMcpUpdated(item, agents, ctx);
      break;
    }
    case "list":
    case undefined: {
      if (!domain.plugin.list) throw new Error("mcp domain has no list()");
      const items = await domain.plugin.list(ctx);
      for (const item of items) opts.logger.info(JSON.stringify(item));
      return;
    }
    default:
      throw new Error(`unknown mcp subcommand: ${opts.sub}`);
  }
}
