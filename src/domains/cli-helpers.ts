import { checkbox, confirm } from "@inquirer/prompts";
import {
  createPrompt,
  isDownKey,
  isEnterKey,
  isSpaceKey,
  isUpKey,
  makeTheme,
  usePagination,
  usePrefix,
  useState,
  useKeypress,
} from "@inquirer/core";
import type { Prompt } from "@inquirer/type";
import type { AgnosConfig, CommandContext, FlagSpec } from "../core/index.js";
import { writeConfig } from "../core/index.js";
import type { MergePolicy } from "./merge.js";

export interface PickChoice {
  name: string;
  value: string;
}

export interface ExclusiveChoice extends PickChoice {
  /**
   * Exclusivity group. Checking a choice automatically unchecks any other choice
   * in the same group, so at most one per group is ever selected. Choices with no
   * group are independent.
   */
  group?: string;
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

interface ExItem extends ExclusiveChoice {
  checked: boolean;
}

/**
 * A checkbox prompt with mutually-exclusive groups: checking an item unchecks any
 * other item sharing its `group`. Built on `@inquirer/core` because the stock
 * `checkbox` has no per-toggle hook to enforce the constraint live. Renders each
 * row as `[ ]/[x] <name>` so the caller controls everything after the box.
 */
interface ExclusiveConfig {
  message: string;
  choices: ExclusiveChoice[];
  pageSize?: number;
}

export const exclusiveCheckbox: Prompt<string[], ExclusiveConfig> = createPrompt<
  string[],
  ExclusiveConfig
>((config, done) => {
  const theme = makeTheme({ icon: { checked: "[x]", unchecked: "[ ]", cursor: ">" } });
  const [status, setStatus] = useState<"idle" | "done">("idle");
  const prefix = usePrefix({ status, theme });
  const [items, setItems] = useState<ExItem[]>(
    config.choices.map((c) => ({ ...c, checked: false })),
  );
  const [active, setActive] = useState(0);

  useKeypress((key) => {
    if (isEnterKey(key)) {
      setStatus("done");
      done(items.filter((i) => i.checked).map((i) => i.value));
    } else if (isUpKey(key) || isDownKey(key)) {
      const offset = isUpKey(key) ? -1 : 1;
      setActive((active + offset + items.length) % items.length);
    } else if (isSpaceKey(key)) {
      const current = items[active]!;
      const turningOn = !current.checked;
      setItems(
        items.map((choice, i) => {
          if (i === active) return { ...choice, checked: turningOn };
          // Turning one on clears the rest of its group.
          if (turningOn && current.group && choice.group === current.group) {
            return { ...choice, checked: false };
          }
          return choice;
        }),
      );
    }
  });

  const message = theme.style.message(config.message, status);
  if (status === "done") {
    const answer = items
      .filter((i) => i.checked)
      .map((i) => i.value)
      .join(", ");
    return `${prefix} ${message} ${theme.style.answer(answer)}`;
  }

  const page = usePagination({
    items,
    active,
    renderItem({ item, isActive }) {
      const box = item.checked ? theme.icon.checked : theme.icon.unchecked;
      const cursor = isActive ? theme.icon.cursor : " ";
      const line = `${cursor}${box} ${item.name}`;
      return isActive ? theme.style.highlight(line) : line;
    },
    pageSize: config.pageSize ?? 10,
    loop: true,
  });

  const help = theme.style.help("(↑↓ navigate · space select · ⏎ submit)");
  return `${prefix} ${message}\n${page}\n${help}`;
});

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
