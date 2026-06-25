import type { CommandSpec, Domain, HookEntry, HookEvent } from "../../core/index.js";
import { hookEventSchema, readConfigOrDefault } from "../../core/index.js";
import { jsonEqual, mergeByIdentity, type ArrayMergeResult, type MergePolicy } from "../merge.js";
import { hookIdentity } from "../../agents/adapters/hooks-map.js";
import { MIGRATE_FLAGS, policyFromFlags, reqArg, writeChange } from "../cli-helpers.js";
import { scrapeActive } from "../agents/index.js";

export { hookIdentity };

/** Reconcile discovered hooks into the existing list, keyed by identity (§13.5). */
export function mergeHooks(
  existing: HookEntry[],
  discovered: HookEntry[],
  policy: MergePolicy,
): ArrayMergeResult<HookEntry> {
  return mergeByIdentity(existing, discovered, hookIdentity, jsonEqual, policy);
}

/** Remove a hook by its identity string. */
export function removeHookById(existing: HookEntry[], id: string): HookEntry[] {
  return existing.filter((h) => hookIdentity(h) !== id);
}

function buildEntry(event: string, command: string, matcher?: string): HookEntry {
  if (!(hookEventSchema.options as readonly string[]).includes(event)) {
    throw new Error(
      `unknown hook event "${event}" (one of: ${hookEventSchema.options.join(", ")})`,
    );
  }
  const entry: HookEntry = { event: event as HookEvent, type: "command", command };
  if (matcher) entry.matcher = matcher;
  return entry;
}

const commands: Record<string, CommandSpec> = {
  add: {
    name: "add",
    description: "Add a command hook",
    args: [
      { name: "event", required: true, description: hookEventSchema.options.join(" | ") },
      { name: "command", required: true, description: "shell command to run" },
      { name: "matcher", required: false, description: "optional event matcher" },
    ],
    async run(ctx) {
      const entry = buildEntry(reqArg(ctx, 0, "event"), reqArg(ctx, 1, "command"), ctx.args[2]);
      const config = await readConfigOrDefault(ctx.configPath);
      const hooks = config.hooks ?? [];
      if (hooks.some((h) => hookIdentity(h) === hookIdentity(entry))) {
        throw new Error(`a hook with that (event, matcher, command) already exists`);
      }
      await writeChange(ctx, `added ${entry.event} hook`, { ...config, hooks: [...hooks, entry] });
    },
  },
  remove: {
    name: "remove",
    description: "Remove a command hook by (event, command, [matcher])",
    args: [
      { name: "event", required: true, description: "hook event" },
      { name: "command", required: true, description: "shell command" },
      { name: "matcher", required: false, description: "optional event matcher" },
    ],
    async run(ctx) {
      const id = hookIdentity(
        buildEntry(reqArg(ctx, 0, "event"), reqArg(ctx, 1, "command"), ctx.args[2]),
      );
      const config = await readConfigOrDefault(ctx.configPath);
      const hooks = config.hooks ?? [];
      const next = removeHookById(hooks, id);
      if (next.length === hooks.length) throw new Error(`no matching hook to remove`);
      await writeChange(ctx, `removed hook`, { ...config, hooks: next });
    },
  },
  migrate: {
    name: "migrate",
    description: "Import hooks from the active agents' native config",
    flags: MIGRATE_FLAGS,
    async run(ctx) {
      const discovered = (await scrapeActive("hooks", ctx)) as HookEntry[];
      const config = await readConfigOrDefault(ctx.configPath);
      const res = mergeHooks(config.hooks ?? [], discovered, policyFromFlags(ctx));
      if (res.aborted) {
        throw new Error(
          `hooks migrate aborted: ${res.conflicts} conflict(s). Re-run with --force or --missing.`,
        );
      }
      await writeChange(ctx, `hooks migrate: +${res.added} added, ${res.overwritten} overwritten`, {
        ...config,
        hooks: res.items,
      });
    },
  },
};

/**
 * The hooks domain: a config writer. It owns `agnos.json#hooks` (a flat array);
 * the agents domain regroups + renders it per-agent. Hooks are added/removed by
 * identity or imported via `migrate`.
 */
export const hooksDomain: Domain = {
  id: "hooks",
  description: "Manage hooks in agnos.json (rendered per-agent by the agents domain)",
  kind: "writer",
  priority: 50,
  commands,
};

export default hooksDomain;
