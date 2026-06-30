import { checkbox, confirm, input, select } from "@inquirer/prompts";
import type {
  AgnosConfig,
  CommandContext,
  ExclusiveChoice,
  FlagSpec,
  PickChoice,
} from "../core/index.js";
import { exclusiveCheckbox, writeConfig } from "../core/index.js";
import type { MergePolicy } from "./merge.js";

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

/**
 * Interactive multi-select with mutually-exclusive groups (see
 * `exclusiveCheckbox`). Same non-interactive guard as {@link multiSelect}: throws
 * `hint` under `-y` or without a TTY so scripts never hang on a prompt.
 */
export async function multiSelectExclusive(
  ctx: CommandContext,
  message: string,
  choices: ExclusiveChoice[],
  hint: string,
): Promise<string[]> {
  if (ctx.flags["yes"] || !process.stdin.isTTY) throw new Error(hint);
  return exclusiveCheckbox({ message, choices });
}

/**
 * Interactive multi-select for commands that never honor `-y` (e.g. `agents
 * add`/`remove`): pass ids to act non-interactively, omit them to pick. Unlike
 * {@link multiSelect}, `-y` is ignored — only a missing TTY refuses (throwing
 * `hint`) so a no-args run can't hang in CI. Uses the themed
 * {@link exclusiveCheckbox} (ungrouped) for a look consistent with the rest.
 */
export async function multiSelectInteractive(
  message: string,
  choices: ExclusiveChoice[],
  hint: string,
): Promise<string[]> {
  if (!process.stdin.isTTY) throw new Error(hint);
  return exclusiveCheckbox({ message, choices });
}

/**
 * Interactive yes/no confirmation. `-y` is an explicit approval and resolves to
 * `true`. Without it, a non-TTY run can't ask — so it resolves to `false` rather
 * than silently approving a destructive action (re-run with `-y` to confirm).
 */
export async function confirmPrompt(
  ctx: CommandContext,
  message: string,
  def = true,
): Promise<boolean> {
  if (ctx.flags["yes"]) return true;
  if (!process.stdin.isTTY) return false;
  return confirm({ message, default: def });
}

/**
 * Free-text prompt. Non-interactively (`-y` or no TTY) returns `opts.default`
 * when one is given, otherwise throws — a value can't be invented silently.
 */
export async function textPrompt(
  ctx: CommandContext,
  message: string,
  opts?: { default?: string; validate?: (value: string) => boolean | string },
): Promise<string> {
  if (ctx.flags["yes"] || !process.stdin.isTTY) {
    if (opts?.default !== undefined) return opts.default;
    throw new Error(`cannot prompt for "${message}" non-interactively`);
  }
  return input({ message, default: opts?.default, validate: opts?.validate });
}

/**
 * Single-choice prompt. Non-interactively (`-y` or no TTY) returns the default
 * (or the first choice) so scripted runs resolve deterministically.
 */
export async function selectPrompt<T extends string>(
  ctx: CommandContext,
  message: string,
  choices: { name: string; value: T; description?: string }[],
  opts?: { default?: T },
): Promise<T> {
  if (ctx.flags["yes"] || !process.stdin.isTTY) {
    const fallback = opts?.default ?? choices[0]?.value;
    if (fallback !== undefined) return fallback;
    throw new Error(`cannot prompt for "${message}" non-interactively`);
  }
  return select<T>({ message, choices, default: opts?.default });
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
