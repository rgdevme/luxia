import type { CommandSpec, Domain } from "./types/public.js";

export const USAGE = `agnos — agent-agnostic project configuration manager

Usage:
  agnos [domain] [--dry] [--once] [--quiet] [--help] [--init [-y]]

  agnos                      Watch all domains and keep agent files in sync
  agnos --once               Run the full pipeline once and exit
  agnos <domain>             Run one domain (docs|rules|skills|mcp|hooks|agents)
  agnos <domain> <sub> …     Run a domain subcommand (e.g. agnos agents add)
  agnos <domain> --help      Show help for a domain (and its subcommands)
  agnos --init [-y]          Bootstrap all domains (or one if a domain is given)

${flagsBlock()}`;

function flagsBlock(): string {
  return `Flags (every command):
  --dry        Resolve + log planned actions; write nothing (implies --once)
  --once       Single pass, no watchers
  --quiet      Errors only
  --init       Run initialization (bootstrap), then exit
  -y, --yes    Accept defaults (non-interactive)
  --cwd <dir>  Run as if invoked from <dir>
  -h, --help   Show this help`;
}

function argUsage(cmd: CommandSpec): string {
  return (cmd.args ?? []).map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`)).join(" ");
}

/** Help for `agnos <domain> --help`: description, how to run it, its subcommands, flags. */
export function domainHelp(domain: Domain): string {
  const out: string[] = [`agnos ${domain.id} — ${domain.description}`, "", "Usage:"];
  out.push(
    `  agnos ${domain.id}            Run the ${domain.id} domain (watch unless --once/--dry)`,
  );
  if (domain.initSteps?.length) {
    out.push(`  agnos ${domain.id} --init [-y]  Bootstrap ${domain.id} configuration`);
  }
  const cmds = Object.values(domain.commands ?? {});
  if (cmds.length > 0) {
    out.push("", "Subcommands:");
    for (const c of cmds) {
      const usage = argUsage(c);
      out.push(`  ${`${c.name}${usage ? ` ${usage}` : ""}`.padEnd(22)} ${c.description}`);
      for (const f of c.flags ?? []) {
        out.push(`    ${`--${f.name}`.padEnd(20)} ${f.description}`);
      }
    }
  }
  out.push("", flagsBlock());
  return `${out.join("\n")}\n`;
}

/** Help for `agnos <domain> <sub> --help`: usage, arguments, and flags. */
export function commandHelp(domainId: string, cmd: CommandSpec): string {
  const usage = argUsage(cmd);
  const out: string[] = [
    `agnos ${domainId} ${cmd.name} — ${cmd.description}`,
    "",
    "Usage:",
    `  agnos ${domainId} ${cmd.name}${usage ? ` ${usage}` : ""}`,
  ];
  const args = cmd.args ?? [];
  if (args.length > 0) {
    out.push("", "Arguments:");
    for (const a of args) out.push(`  ${a.name.padEnd(14)} ${a.description}`);
  }
  const flags = cmd.flags ?? [];
  if (flags.length > 0) {
    out.push("", "Flags:");
    for (const f of flags) out.push(`  ${`--${f.name}`.padEnd(14)} ${f.description}`);
  }
  out.push("", flagsBlock());
  return `${out.join("\n")}\n`;
}
