import type { CommandSpec, Domain, HookEntry, HookEvent } from "../../core/index.js";
import { hookEventSchema, readConfigOrDefault } from "../../core/index.js";
import { jsonEqual, mergeByIdentity, type ArrayMergeResult, type MergePolicy } from "../merge.js";
import { hookIdentity } from "../../agents/adapters/hooks-map.js";
import {
  MIGRATE_FLAGS,
  multiSelect,
  policyFromFlags,
  reqArg,
  writeChange,
} from "../cli-helpers.js";
import { agentsMissingHookEvent, scrapeActive } from "../agents/index.js";

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
      const unsupported = agentsMissingHookEvent(entry.event, config, ctx);
      if (unsupported.length > 0) {
        ctx.logger.warn(
          `event "${entry.event}" is not supported by ${unsupported.map((a) => a.displayName).join(", ")}; ` +
            `the hook will not be rendered for ${unsupported.length === 1 ? "it" : "them"}`,
        );
      }
      await writeChange(ctx, `added ${entry.event} hook`, { ...config, hooks: [...hooks, entry] });
    },
  },
  remove: {
    name: "remove",
    description: "Remove command hooks (multiselect prompt when no args are given)",
    args: [
      { name: "event", required: false, description: "hook event" },
      { name: "command", required: false, description: "shell command" },
      { name: "matcher", required: false, description: "optional event matcher" },
    ],
    async run(ctx) {
      const config = await readConfigOrDefault(ctx.configPath);
      const hooks = config.hooks ?? [];
      if (hooks.length === 0) {
        ctx.logger.info("no hooks to remove");
        return;
      }
      let ids: string[];
      if (ctx.args.length === 0) {
        ids = await multiSelect(
          ctx,
          "Select hooks to remove:",
          hooks.map((h) => ({
            name: `${h.event}${h.matcher ? ` [${h.matcher}]` : ""} → ${h.command}`,
            value: hookIdentity(h),
          })),
          "specify <event> <command> [matcher] to remove, or run in a terminal to pick them",
        );
      } else {
        ids = [
          hookIdentity(buildEntry(reqArg(ctx, 0, "event"), reqArg(ctx, 1, "command"), ctx.args[2])),
        ];
      }
      if (ids.length === 0) {
        ctx.logger.info("nothing selected");
        return;
      }
      const idset = new Set(ids);
      const next = hooks.filter((h) => !idset.has(hookIdentity(h)));
      if (next.length === hooks.length) throw new Error(`no matching hook to remove`);
      await writeChange(ctx, `removed ${hooks.length - next.length} hook(s)`, {
        ...config,
        hooks: next,
      });
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
  color: "yellow",
  commands,
};

export default hooksDomain;
