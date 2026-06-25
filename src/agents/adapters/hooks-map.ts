import type { HookEntry, HookEvent } from "../../core/index.js";
import { hookEventSchema } from "../../core/index.js";

/**
 * An agent's native hooks shape: event → matcher groups → command handlers.
 * Both Claude Code (`.claude/settings.json#hooks`) and Codex (`.codex/hooks.json#hooks`)
 * use this record form, so the regroup/flatten logic is shared; agents differ
 * only in which events they support and whether they carry `statusMessage`.
 */
export interface NativeHookHandler {
  type: "command";
  command: string;
  statusMessage?: string;
}

export interface NativeHookGroup {
  matcher?: string;
  hooks: NativeHookHandler[];
}

export type NativeHooks = Record<string, NativeHookGroup[]>;

const KNOWN_EVENTS: ReadonlySet<string> = new Set(hookEventSchema.options);

export interface GroupOptions {
  /** Restrict to these events (e.g. the subset an agent supports). Omit = all. */
  events?: ReadonlySet<HookEvent>;
  /** Render `message` as the handler's `statusMessage` (agents that support it). */
  withMessage?: boolean;
}

/**
 * Regroup a flat hook array into an agent's native record, grouping by
 * `(event, matcher)`. Deterministic: events and matcher groups appear in first-
 * seen order, so re-rendering identical input yields byte-identical output.
 * Returns the count of entries dropped because the agent doesn't support them.
 */
export function groupHooks(
  entries: HookEntry[],
  opts: GroupOptions = {},
): { hooks: NativeHooks; dropped: number } {
  const hooks: NativeHooks = {};
  let dropped = 0;

  for (const entry of entries) {
    if (opts.events && !opts.events.has(entry.event)) {
      dropped++;
      continue;
    }
    const groups = (hooks[entry.event] ??= []);
    const matcher = entry.matcher;
    let group = groups.find((g) => g.matcher === matcher);
    if (!group) {
      group = matcher === undefined ? { hooks: [] } : { matcher, hooks: [] };
      groups.push(group);
    }
    const handler: NativeHookHandler = { type: "command", command: entry.command };
    if (opts.withMessage && entry.message !== undefined) handler.statusMessage = entry.message;
    group.hooks.push(handler);
  }

  return { hooks, dropped };
}

/**
 * Flatten an agent's native hooks record back into the canonical flat array.
 * Keeps only known events and `command` handlers; maps `statusMessage` →
 * `message`. Used by the reverse-import (`scrape`) path. Never throws.
 */
export function flattenHooks(native: unknown): HookEntry[] {
  if (!native || typeof native !== "object" || Array.isArray(native)) return [];
  const out: HookEntry[] = [];
  for (const [event, rawGroups] of Object.entries(native as Record<string, unknown>)) {
    if (!KNOWN_EVENTS.has(event) || !Array.isArray(rawGroups)) continue;
    for (const rawGroup of rawGroups) {
      if (!rawGroup || typeof rawGroup !== "object") continue;
      const group = rawGroup as { matcher?: unknown; hooks?: unknown };
      const matcher = typeof group.matcher === "string" ? group.matcher : undefined;
      if (!Array.isArray(group.hooks)) continue;
      for (const rawHandler of group.hooks) {
        if (!rawHandler || typeof rawHandler !== "object") continue;
        const h = rawHandler as Record<string, unknown>;
        if (h["type"] !== "command" || typeof h["command"] !== "string") continue;
        const entry: HookEntry = {
          event: event as HookEvent,
          type: "command",
          command: h["command"],
        };
        if (matcher !== undefined) entry.matcher = matcher;
        if (typeof h["statusMessage"] === "string") entry.message = h["statusMessage"];
        out.push(entry);
      }
    }
  }
  return out;
}

/**
 * Identity of a hook entry for dedup/removal, keyed on `(event, matcher, command)`.
 * JSON-encoded so any character in `matcher`/`command` is unambiguous.
 */
export function hookIdentity(entry: HookEntry): string {
  return JSON.stringify([entry.event, entry.matcher ?? null, entry.command]);
}
