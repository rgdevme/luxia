import type { HookEntry, HookEvent, HookEventMap } from "../../core/index.js";

/**
 * An agent's native hooks shape: event → matcher groups → command handlers.
 * Claude Code, Codex, and Gemini CLI all use this record form; agents differ
 * only in their native event names (see {@link HookEventMap}) and whether they
 * carry a `statusMessage`.
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

export interface RenderOptions {
  /** Render `message` as the handler's `statusMessage` (agents that support it). */
  withMessage?: boolean;
}

/** Whether an agent's mapping supports a given canonical event. */
export function supportsHookEvent(map: HookEventMap | undefined, event: HookEvent): boolean {
  return !!map && event in map;
}

/**
 * Render the canonical flat hook array into an agent's native record, keyed by
 * that agent's *native* event names via `map`. Groups by `(nativeEvent, matcher)`
 * in first-seen order, so re-rendering identical input yields byte-identical
 * output. Entries whose event the agent doesn't support are skipped and counted
 * in `dropped` — they stay in the central registry, just not in this agent.
 */
export function renderNativeHooks(
  entries: HookEntry[],
  map: HookEventMap,
  opts: RenderOptions = {},
): { hooks: NativeHooks; dropped: number } {
  const hooks: NativeHooks = {};
  let dropped = 0;

  for (const entry of entries) {
    const nativeEvent = map[entry.event];
    if (!nativeEvent) {
      dropped++;
      continue;
    }
    const groups = (hooks[nativeEvent] ??= []);
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
 * Flatten an agent's native hooks record back into the canonical flat array,
 * translating native event names to canonical ones via `map`. Keeps only events
 * the agent maps and `command` handlers; maps `statusMessage` → `message`. Used
 * by the reverse-import (`scrape`) path. Never throws.
 */
export function scrapeNativeHooks(native: unknown, map: HookEventMap): HookEntry[] {
  if (!native || typeof native !== "object" || Array.isArray(native)) return [];
  const nativeToCanonical = new Map<string, HookEvent>();
  for (const [canonical, nativeName] of Object.entries(map)) {
    if (nativeName) nativeToCanonical.set(nativeName, canonical as HookEvent);
  }
  const out: HookEntry[] = [];
  for (const [nativeEvent, rawGroups] of Object.entries(native as Record<string, unknown>)) {
    const event = nativeToCanonical.get(nativeEvent);
    if (!event || !Array.isArray(rawGroups)) continue;
    for (const rawGroup of rawGroups) {
      if (!rawGroup || typeof rawGroup !== "object") continue;
      const group = rawGroup as { matcher?: unknown; hooks?: unknown };
      const matcher = typeof group.matcher === "string" ? group.matcher : undefined;
      if (!Array.isArray(group.hooks)) continue;
      for (const rawHandler of group.hooks) {
        if (!rawHandler || typeof rawHandler !== "object") continue;
        const h = rawHandler as Record<string, unknown>;
        if (h["type"] !== "command" || typeof h["command"] !== "string") continue;
        const entry: HookEntry = { event, type: "command", command: h["command"] };
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
