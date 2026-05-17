import minimist from "minimist";
import { createLogger } from "./logger.js";
import { runInit } from "./commands/init.js";
import { runRules } from "./commands/rules.js";
import { runAgents, runAgentAdd, runAgentRemove } from "./commands/agents.js";
import { runSkill } from "./commands/skill.js";
import { runMcp } from "./commands/mcp.js";
import { runInstallCommand } from "./commands/install.js";
import { runDomainCli } from "./commands/domain-cli.js";
import { RESERVED_CLI_IDS } from "./types/public.js";
import type { PackageManager } from "./pkg-manager.js";

const USAGE = `agnos - agent-agnostic project configuration manager

Usage:
  agnos init [-y] [--install|--no-install]
                                        Initialize agnos (= install bundled plugins
                                        locally + agnos rules + agnos agents)
  agnos rules [path]                    Set the rules-source path (default ./AGENTS.md)
  agnos agents                          Pick which agent plugins to enable
  agnos agent add <id|pkg>              Install + activate an agent plugin
  agnos agent remove <id>               Deactivate + uninstall an agent plugin
  agnos skill add <ref>                 Add a skill (e.g. github:owner/repo/path)
  agnos skill remove <name>             Remove a skill
  agnos skill update <name>             Re-fetch a skill from its source
  agnos mcp add <name>                  Add an MCP server
  agnos mcp remove <name>               Remove an MCP server
  agnos mcp update <name>               Update an MCP server
  agnos install                         Materialize current config for declared agents

Common flags:
  -y, --yes                             Skip prompts (non-interactive defaults)
      --no-install                      For add/remove/update: skip the trailing install
      --no-activate                     For \`agent add\`: install but don't activate
      --copy-on-no-symlink              Auto-copy when symlinks aren't available
      --dry-run                         Log planned actions without invoking them
  -q, --quiet                           Suppress info/success/debug output (errors still print)
      --cwd <dir>                       Run as if invoked from <dir>
      --debug                           Verbose diagnostics
  -h, --help                            Show this help
`;

async function main(): Promise<void> {
  const argv = minimist(process.argv.slice(2), {
    boolean: [
      "yes",
      "help",
      "debug",
      "install",
      "no-install",
      "no-activate",
      "copy-on-no-symlink",
      "dry-run",
      "quiet",
    ],
    alias: { y: "yes", h: "help", q: "quiet" },
    string: ["cwd", "package-manager"],
  });

  if (argv["help"] && argv._.length === 0) {
    process.stdout.write(USAGE);
    return;
  }

  const cwd = typeof argv["cwd"] === "string" ? argv["cwd"] : process.cwd();
  const dryRun = Boolean(argv["dry-run"]);
  const quiet = Boolean(argv["quiet"]);
  const logger = createLogger({ debug: Boolean(argv["debug"]), quiet });

  if (dryRun && quiet) {
    logger.warn("`--dry-run --quiet` together produces no output; dropping --quiet.");
  }
  const effectiveLogger =
    dryRun && quiet ? createLogger({ debug: Boolean(argv["debug"]) }) : logger;

  const [command, sub, ...rest] = argv._;

  try {
    switch (command) {
      case undefined:
        process.stdout.write(USAGE);
        return;
      case "init": {
        let install: boolean | undefined;
        if (argv["no-install"]) install = false;
        else if (argv["install"]) install = true;
        const pmRaw = argv["package-manager"];
        const packageManager =
          typeof pmRaw === "string" && ["npm", "pnpm", "yarn", "bun"].includes(pmRaw)
            ? (pmRaw as PackageManager)
            : undefined;
        await runInit({
          cwd,
          yes: Boolean(argv["yes"]),
          copyOnNoSymlink: Boolean(argv["copy-on-no-symlink"]),
          dryRun,
          install,
          packageManager,
          logger: effectiveLogger,
        });
        return;
      }
      case "rules":
        await runRules({
          cwd,
          path: sub,
          yes: Boolean(argv["yes"]),
          dryRun,
          logger: effectiveLogger,
        });
        return;
      case "agents":
        await runAgents({
          cwd,
          copyOnNoSymlink: Boolean(argv["copy-on-no-symlink"]),
          dryRun,
          logger: effectiveLogger,
        });
        return;
      case "agent":
        if (sub === "add") {
          await runAgentAdd({
            cwd,
            target: rest[0],
            noInstall: Boolean(argv["no-install"]),
            noActivate: Boolean(argv["no-activate"]),
            copyOnNoSymlink: Boolean(argv["copy-on-no-symlink"]),
            dryRun,
            logger: effectiveLogger,
          });
          return;
        }
        if (sub === "remove") {
          await runAgentRemove({ cwd, id: rest[0], dryRun, logger: effectiveLogger });
          return;
        }
        fail(`Unknown agent subcommand: ${sub ?? "(none)"}`);
        return;
      case "skill":
        await runSkill({
          cwd,
          sub,
          args: rest,
          noInstall: Boolean(argv["no-install"]),
          copyOnNoSymlink: Boolean(argv["copy-on-no-symlink"]),
          dryRun,
          logger: effectiveLogger,
        });
        return;
      case "mcp":
        await runMcp({
          cwd,
          sub,
          args: rest,
          noInstall: Boolean(argv["no-install"]),
          copyOnNoSymlink: Boolean(argv["copy-on-no-symlink"]),
          dryRun,
          logger: effectiveLogger,
        });
        return;
      case "install":
        await runInstallCommand({
          cwd,
          copyOnNoSymlink: Boolean(argv["copy-on-no-symlink"]),
          dryRun,
          logger: effectiveLogger,
        });
        return;
      default: {
        if (RESERVED_CLI_IDS.includes(command as (typeof RESERVED_CLI_IDS)[number])) {
          fail(`Unknown command: ${command}`);
        }
        const positional = sub === undefined ? [] : [sub, ...rest];
        const { flags } = extractFlags(argv);
        const handled = await runDomainCli({
          cwd,
          domainId: command,
          sub,
          positional,
          flags,
          logger: effectiveLogger,
        });
        if (!handled) fail(`Unknown command: ${command}`);
        return;
      }
    }
  } catch (err) {
    const e = err as Error & { cause?: unknown };
    effectiveLogger.error(e.message);
    if (argv["debug"]) {
      console.error(e.stack);
      let cause: unknown = e.cause;
      while (cause) {
        const c = cause as Error & { cause?: unknown };
        console.error(`  caused by: ${c.message ?? c}`);
        if (c.stack) console.error(c.stack);
        cause = c.cause;
      }
    }
    process.exitCode = 1;
  }
}

function fail(msg: string): never {
  process.stderr.write(`${msg}\n\n${USAGE}`);
  process.exit(1);
}

function extractFlags(argv: minimist.ParsedArgs): { flags: Record<string, unknown> } {
  const flags: Record<string, unknown> = {};
  for (const key of Object.keys(argv)) {
    if (key === "_") continue;
    flags[key] = argv[key];
  }
  return { flags };
}

void main();
