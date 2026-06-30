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
import figures from "@inquirer/figures";
import colors from "yoctocolors-cjs";

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
  /** Longer blurb shown (dimmed/cyan) on its own line when the row is active. */
  description?: string;
  /** Initially checked (e.g. an already-installed skill). */
  checked?: boolean;
  /**
   * Greyed-out, non-toggleable row. Rendered dimmed, ignored by the space key,
   * and excluded from the result — used to show already-installed entries that
   * can't be unchecked (the picker stays additive).
   */
  disabled?: boolean;
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
export interface ExclusiveConfig {
  message: string;
  choices: ExclusiveChoice[];
  pageSize?: number;
}

export const exclusiveCheckbox: Prompt<string[], ExclusiveConfig> = createPrompt<
  string[],
  ExclusiveConfig
>((config, done) => {
  // Mirror the stock `@inquirer/prompts` checkbox look: filled/empty circles, a
  // pointer cursor, and a cyan description line — so this custom prompt doesn't
  // read as plain ASCII text next to the rest of the CLI's prompts.
  const theme = makeTheme({
    icon: {
      checked: colors.green(figures.circleFilled),
      unchecked: figures.circle,
      cursor: figures.pointer,
    },
    style: { description: (text: string) => colors.cyan(text) },
  });
  const [status, setStatus] = useState<"idle" | "done">("idle");
  const prefix = usePrefix({ status, theme });
  const [items, setItems] = useState<ExItem[]>(
    config.choices.map((c) => ({ ...c, checked: c.checked ?? false })),
  );
  const [active, setActive] = useState(0);

  useKeypress((key) => {
    if (isEnterKey(key)) {
      setStatus("done");
      done(items.filter((i) => i.checked && !i.disabled).map((i) => i.value));
    } else if (isUpKey(key) || isDownKey(key)) {
      const offset = isUpKey(key) ? -1 : 1;
      setActive((active + offset + items.length) % items.length);
    } else if (isSpaceKey(key)) {
      const current = items[active]!;
      if (current.disabled) return;
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
      .filter((i) => i.checked && !i.disabled)
      .map((i) => i.value)
      .join(", ");
    return `${prefix} ${message} ${theme.style.answer(answer)}`;
  }

  let description: string | undefined;
  const page = usePagination({
    items,
    active,
    renderItem({ item, isActive }) {
      if (isActive) description = item.description;
      const box = item.checked ? theme.icon.checked : theme.icon.unchecked;
      const cursor = isActive ? theme.icon.cursor : " ";
      const line = `${cursor}${box} ${item.name}`;
      if (item.disabled) return colors.dim(line);
      return isActive ? theme.style.highlight(line) : line;
    },
    pageSize: config.pageSize ?? 10,
    loop: true,
  });

  const help = theme.style.help("(↑↓ navigate · space select · ⏎ submit)");
  return [
    `${prefix} ${message}`,
    page,
    " ",
    description ? theme.style.description(description) : "",
    help,
  ]
    .filter(Boolean)
    .join("\n")
    .trimEnd();
});
