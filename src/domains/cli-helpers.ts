import { checkbox } from "@inquirer/prompts";
import type { AgnosConfig, CommandContext, FlagSpec } from "../core/index.js";
import { writeConfig } from "../core/index.js";
import type { MergePolicy } from "./merge.js";

export interface PickChoice {
  name: string;
  value: string;
}

/**
 * Interactive multi-select used by the `remove` subcommands when no target is
 * given. Refuses (throwing `hint`) when non-interactive (`-y` or no TTY) so a
 * command never hangs on a prompt in scripts/CI.
 */
export async function multiSelect(
  ctx: CommandContext,
  message: string,
  choices: PickChoice[],
  hint: string,
): Promise<string[]> {
  if (ctx.flags["yes"] || !process.stdin.isTTY) throw new Error(hint);
  return checkbox({ message, choices });
}

/** Conflict-policy flags shared by the `migrate` subcommands. */
export const MIGRATE_FLAGS: FlagSpec[] = [
  {
    name: "missing",
    type: "boolean",
    description: "add only entries not already present (default)",
  },
  { name: "force", type: "boolean", description: "overwrite conflicting entries and add missing" },
  { name: "skip", type: "boolean", description: "abort if any entry conflicts" },
];

export function policyFromFlags(ctx: CommandContext): MergePolicy {
  if (ctx.flags["force"]) return "force";
  if (ctx.flags["skip"]) return "skip";
  return "missing";
}

/** Read a required positional argument or throw a clear usage error. */
export function reqArg(ctx: CommandContext, index: number, name: string): string {
  const v = ctx.args[index];
  if (!v) throw new Error(`missing argument <${name}>`);
  return v;
}

/** Persist a mutated config (honoring --dry) and log the outcome. */
export async function writeChange(
  ctx: CommandContext,
  label: string,
  next: AgnosConfig,
): Promise<void> {
  if (ctx.dryRun) {
    ctx.logger.info(`would: ${label}`);
    return;
  }
  await writeConfig(ctx.configPath, next);
  ctx.logger.success(label);
}
