import type { Domain, HookEntry } from "../../core/index.js";
import { jsonEqual, mergeByIdentity, type ArrayMergeResult, type MergePolicy } from "../merge.js";
import { hookIdentity } from "../../agents/adapters/hooks-map.js";

export { hookIdentity };

/** Reconcile discovered hooks into the existing list, keyed by identity (§13.5). */
export function mergeHooks(
  existing: HookEntry[],
  discovered: HookEntry[],
  policy: MergePolicy,
): ArrayMergeResult<HookEntry> {
  return mergeByIdentity(existing, discovered, hookIdentity, jsonEqual, policy);
}

/** Remove a hook by its identity (`agnos hooks remove <id>`). */
export function removeHookById(existing: HookEntry[], id: string): HookEntry[] {
  return existing.filter((h) => hookIdentity(h) !== id);
}

/**
 * The hooks domain: a config writer. It owns `agnos.json#hooks` (a flat array);
 * the agents domain regroups + renders it into per-agent native files. Hooks are
 * added manually (`agnos hooks add`) or imported (`migrate`); removal is by
 * identity, or a multiselect when no id is given. Subcommands are wired in M8.
 */
export const hooksDomain: Domain = {
  id: "hooks",
  description: "Manage hooks in agnos.json (rendered per-agent by the agents domain)",
  kind: "writer",
  priority: 50,
};

export default hooksDomain;
