import minimist from "minimist";
import {
  buildResolveContext,
  createLogger,
  loadPlugins,
  runAll,
  runAllDomainInitSteps,
  runOne,
} from "./index.js";
import type { CommandContext, DomainRunOptions, ParsedFlags, RunContext } from "./index.js";
import { startWatch } from "./watch.js";

const USAGE = `agnos — agent-agnostic project configuration manager

Usage:
  agnos [domain] [--dry] [--once] [--quiet] [--help] [--init [-y]]

  agnos                      Watch all domains and keep agent files in sync
  agnos --once               Run the full pipeline once and exit
  agnos <domain>             Run one domain (docs|rules|skills|mcp|hooks|agents)
  agnos <domain> <sub> …     Run a domain subcommand (e.g. agnos agents add)
  agnos --init [-y]          Bootstrap all domains (or one if a domain is given)

Flags (every command):
  --dry        Resolve + log planned actions; write nothing (implies --once)
  --once       Single pass, no watchers
  --quiet      Errors only
  --init       Run initialization (bootstrap), then exit
  -y, --yes    Accept defaults (non-interactive)
  --cwd <dir>  Run as if invoked from <dir>
  -h, --help   Show this help
`;

async function main(): Promise<void> {
  const argv = minimist(process.argv.slice(2), {
    boolean: ["dry", "once", "quiet", "help", "init", "yes", "debug"],
    alias: { y: "yes", h: "help" },
    string: ["cwd"],
  });

  const flags: ParsedFlags = {
    dry: Boolean(argv["dry"]),
    once: Boolean(argv["once"]) || Boolean(argv["dry"]), // --dry implies --once
    quiet: Boolean(argv["quiet"]),
    help: Boolean(argv["help"]),
    init: Boolean(argv["init"]),
    yes: Boolean(argv["yes"]),
  };

  if (flags.help) {
    process.stdout.write(USAGE);
    return;
  }

  const positional = argv._.map(String);
  const [domainId, sub, ...rest] = positional;
  const cwd = typeof argv["cwd"] === "string" ? argv["cwd"] : process.cwd();
  const logger = createLogger({ debug: Boolean(argv["debug"]), quiet: flags.quiet });

  const opts: DomainRunOptions = {
    dry: flags.dry,
    once: flags.once,
    quiet: flags.quiet,
    interactive: !flags.yes,
  };

  try {
    const base = await buildResolveContext({ projectRoot: cwd, dryRun: flags.dry, logger });
    const registry = await loadPlugins({ projectRoot: cwd, logger });
    const ctx: RunContext = { ...base, flags };

    if (flags.init) {
      await runAllDomainInitSteps(
        registry,
        ctx,
        { yes: flags.yes, dryRun: flags.dry },
        domainId ? [domainId] : undefined,
      );
      return;
    }

    if (!domainId) {
      if (flags.once) await runAll(registry, opts, ctx);
      else await startWatch(registry, opts, ctx);
      return;
    }

    const dom = registry.domains.get(domainId);
    if (!dom) {
      fail(`unknown domain: ${domainId}`);
      return;
    }

    if (sub) {
      const cmd = dom.domain.commands?.[sub];
      if (!cmd) {
        fail(`unknown subcommand "${sub}" for ${domainId}`);
        return;
      }
      const cmdCtx: CommandContext = { ...ctx, args: rest };
      await cmd.run(cmdCtx);
      return;
    }

    if (flags.once) await runOne(registry, domainId, opts, ctx);
    else await startWatch(registry, opts, ctx, domainId);
  } catch (err) {
    logger.error((err as Error).message);
    if (argv["debug"]) console.error((err as Error).stack);
    process.exitCode = 1;
  }
}

function fail(msg: string): void {
  process.stderr.write(`${msg}\n\n${USAGE}`);
  process.exitCode = 1;
}

void main();
