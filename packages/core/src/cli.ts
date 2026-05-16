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

const USAGE = `agnos - agent-agnostic project configuration manager

Usage:
  agnos init [-y]                       Initialize agnos (= agnos rules + agnos agents)
  agnos rules [path]                    Set the rules-source path (default ./AGENTS.md)
  agnos agents                          Pick which agent plugins to enable
  agnos agent add <id|pkg>              Install + register an agent plugin
  agnos agent remove <id>               Uninstall + clean up an agent plugin
  agnos skill add <ref>                 Add a skill (e.g. github:owner/repo/path)
  agnos skill remove <name>             Remove a skill
  agnos skill update <name>             Re-fetch a skill from its source
  agnos mcp add <name>                  Add an MCP server
  agnos mcp remove <name>               Remove an MCP server
  agnos mcp update <name>               Update an MCP server
  agnos install                         Materialize current config for declared agents

Common flags:
  -y, --yes                             Skip prompts (non-interactive defaults)
  --no-install                          For add/remove/update: skip the trailing install
  --copy-on-no-symlink                  Auto-copy when symlinks aren't available
  --cwd <dir>                           Run as if invoked from <dir>
  --debug                               Verbose diagnostics
  -h, --help                            Show this help
`;

async function main(): Promise<void> {
  const argv = minimist(process.argv.slice(2), {
    boolean: ["yes", "help", "debug", "no-install", "copy-on-no-symlink"],
    alias: { y: "yes", h: "help" },
    string: ["cwd"],
  });

  if (argv["help"] && argv._.length === 0) {
    process.stdout.write(USAGE);
    return;
  }

  const cwd = typeof argv["cwd"] === "string" ? argv["cwd"] : process.cwd();
  const logger = createLogger({ debug: Boolean(argv["debug"]) });

  const [command, sub, ...rest] = argv._;

  try {
    switch (command) {
      case undefined:
        process.stdout.write(USAGE);
        return;
      case "init":
        await runInit({ cwd, yes: Boolean(argv["yes"]), copyOnNoSymlink: Boolean(argv["copy-on-no-symlink"]), logger });
        return;
      case "rules":
        await runRules({ cwd, path: sub, yes: Boolean(argv["yes"]), logger });
        return;
      case "agents":
        await runAgents({ cwd, copyOnNoSymlink: Boolean(argv["copy-on-no-symlink"]), logger });
        return;
      case "agent":
        if (sub === "add") {
          await runAgentAdd({
            cwd,
            target: rest[0],
            noInstall: Boolean(argv["no-install"]),
            copyOnNoSymlink: Boolean(argv["copy-on-no-symlink"]),
            yes: Boolean(argv["yes"]),
            logger,
          });
          return;
        }
        if (sub === "remove") {
          await runAgentRemove({ cwd, id: rest[0], logger });
          return;
        }
        fail(`Unknown agent subcommand: ${sub ?? "(none)"}`);
        return;
      case "skill":
        await runSkill({ cwd, sub, args: rest, noInstall: Boolean(argv["no-install"]), copyOnNoSymlink: Boolean(argv["copy-on-no-symlink"]), logger });
        return;
      case "mcp":
        await runMcp({ cwd, sub, args: rest, noInstall: Boolean(argv["no-install"]), copyOnNoSymlink: Boolean(argv["copy-on-no-symlink"]), logger });
        return;
      case "install":
        await runInstallCommand({ cwd, copyOnNoSymlink: Boolean(argv["copy-on-no-symlink"]), logger });
        return;
      default: {
        if (RESERVED_CLI_IDS.includes(command as typeof RESERVED_CLI_IDS[number])) {
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
          logger,
        });
        if (!handled) fail(`Unknown command: ${command}`);
        return;
      }
    }
  } catch (err) {
    logger.error((err as Error).message);
    if (argv["debug"]) console.error((err as Error).stack);
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
