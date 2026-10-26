import minimist from "minimist";
import path from "node:path";
import {
  buildResolveContext,
  createLogger,
  loadPlugins,
  migrateLegacySkillSources,
  runAll,
  runAllDomainInitSteps,
  runOne,
  withDomain,
} from "./index.js";
import type { CommandContext, DomainRunOptions, ParsedFlags, RunContext } from "./index.js";
import { startWatch } from "./watch.js";
import { USAGE, commandHelp, domainHelp } from "./help.js";

async function main(): Promise<void> {
  const argv = minimist(process.argv.slice(2), {
    boolean: ["dry", "once", "quiet", "help", "init", "yes", "debug", "missing", "force", "skip"],
    alias: { y: "yes", h: "help", p: "provider", s: "skills" },
    string: ["cwd", "provider", "skills"],
  });

  const flags: ParsedFlags = {
    dry: Boolean(argv["dry"]),
    once: Boolean(argv["once"]) || Boolean(argv["dry"]), // --dry implies --once
    quiet: Boolean(argv["quiet"]),
    help: Boolean(argv["help"]),
    init: Boolean(argv["init"]),
    yes: Boolean(argv["yes"]),
  };
  // Carry command-local flags (e.g. --force/--missing/--skip) through to commands.
  for (const [k, v] of Object.entries(argv)) {
    if (k !== "_" && !(k in flags)) flags[k] = v;
  }

  const positional = argv._.map(String);
  const [domainId, sub, ...rest] = positional;
  const cwd = typeof argv["cwd"] === "string" ? argv["cwd"] : process.cwd();
  const logger = createLogger({ debug: Boolean(argv["debug"]), quiet: flags.quiet });

  if (flags.help) {
    if (!domainId) {
      process.stdout.write(USAGE);
      return;
    }
    try {
      const registry = await loadPlugins({ projectRoot: cwd, logger });
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
        process.stdout.write(commandHelp(domainId, cmd));
      } else {
        process.stdout.write(domainHelp(dom.domain));
      }
    } catch (err) {
      logger.error((err as Error).message);
      process.exitCode = 1;
    }
    return;
  }

  const opts: DomainRunOptions = {
    dry: flags.dry,
    once: flags.once,
    quiet: flags.quiet,
    interactive: !flags.yes,
  };

  try {
    const configPath = path.join(cwd, "agnos.json");
    const migration =
      flags.init && (!domainId || domainId === "skills")
        ? await migrateLegacySkillSources(configPath, cwd, flags.dry, (message) =>
            logger.info(message),
          )
        : undefined;
    const base = await buildResolveContext({
      projectRoot: cwd,
      dryRun: flags.dry,
      logger,
      ...(migration?.config ? { config: migration.config } : {}),
    });
    const registry = await loadPlugins({ projectRoot: cwd, logger });
    const ctx: RunContext = { ...base, flags };

    if (flags.init) {
      const ok = await runAllDomainInitSteps(
        registry,
        ctx,
        { yes: flags.yes, dryRun: flags.dry },
        domainId ? [domainId] : undefined,
      );
      if (!ok) process.exitCode = 1;
      return;
    }

    if (!domainId) {
      if (flags.once) {
        const result = await runAll(registry, opts, ctx);
        if (!result.ok) process.exitCode = 1;
      } else await startWatch(registry, opts, ctx);
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
      // Scope the logger to the owning domain so command output carries its
      // `[domain]` prefix and color, matching run-mode output.
      const cmdCtx: CommandContext = {
        ...ctx,
        args: rest,
        logger: withDomain(ctx.logger, dom.domain),
      };
      try {
        await cmd.run(cmdCtx);
      } finally {
        await cmdCtx.fetcher.cleanup();
      }
      return;
    }

    if (flags.once) {
      const result = await runOne(registry, domainId, opts, ctx);
      if (!result.ok) process.exitCode = 1;
    } else await startWatch(registry, opts, ctx, domainId);
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
