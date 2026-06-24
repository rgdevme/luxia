import { loadPlugins } from "../plugin-loader.js";
import { buildResolveContext } from "../context.js";
import { runDomainInitSteps } from "./init-steps.js";
import type { CliCommand, Logger } from "../types/public.js";

export interface DomainCliOptions {
  cwd: string;
  domainId: string;
  sub: string | undefined;
  positional: string[];
  flags: Record<string, unknown>;
  logger: Logger;
}

export async function runDomainCli(opts: DomainCliOptions): Promise<boolean> {
  const registry = await loadPlugins({ projectRoot: opts.cwd, logger: opts.logger });
  const dom = registry.domains.get(opts.domainId);
  if (!dom) return false;
  // A domain with no cli but with initSteps still gets a synthesized `init`.
  const hasInitSteps = (dom.plugin.initSteps?.length ?? 0) > 0;
  if (!dom.plugin.cli && !hasInitSteps) return false;

  const ctx = await buildResolveContext({ projectRoot: opts.cwd, logger: opts.logger });
  const cliMap = dom.plugin.cli ?? {};

  if (opts.sub === undefined) {
    const cmd = cliMap["default"];
    if (cmd) {
      await cmd.run({ positional: [], flags: opts.flags }, ctx);
      return true;
    }
    listAvailable(opts.domainId, cliMap, opts.logger);
    return true;
  }

  const cmd = cliMap[opts.sub];
  if (!cmd) {
    // Synthesize `<domain> init` from initSteps when the plugin doesn't
    // declare its own cli.init.
    if (opts.sub === "init" && dom.plugin.initSteps && dom.plugin.initSteps.length > 0) {
      await runDomainInitSteps(dom.plugin, ctx, {
        yes: false,
        dryRun: ctx.dryRun ?? false,
      });
      return true;
    }
    opts.logger.error(`unknown ${opts.domainId} subcommand: ${opts.sub}`);
    listAvailable(opts.domainId, cliMap, opts.logger);
    process.exitCode = 1;
    return true;
  }

  const positional = opts.positional.length > 0 ? opts.positional.slice(1) : [];
  await cmd.run({ positional, flags: opts.flags }, ctx);
  return true;
}

function listAvailable(domainId: string, cliMap: Record<string, CliCommand>, logger: Logger): void {
  const entries = Object.entries(cliMap).filter(([name]) => name !== "default");
  if (entries.length === 0) {
    logger.info(`no subcommands available under \`agnos ${domainId}\``);
    return;
  }
  logger.info(`available \`agnos ${domainId}\` subcommands:`);
  for (const [name, cmd] of entries) {
    logger.info(`  ${name.padEnd(12)} ${cmd.description}`);
  }
}
