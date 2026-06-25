/** Conflict-resolution policy for `migrate` across writer domains. */
export type MergePolicy = "missing" | "force" | "skip";

export interface MergeResult {
  /** The reconciled source map (unchanged from `existing` when aborted). */
  sources: Record<string, string>;
  added: string[];
  overwritten: string[];
  /** Names present in both with a differing source. */
  conflicts: string[];
  /** True when `skip` aborted the whole migrate because a conflict existed. */
  aborted: boolean;
}

/**
 * Reconcile discovered skill sources into the existing map under a policy:
 *  - `missing` — add only names absent from `existing`; leave conflicts as-is.
 *  - `force`   — add missing AND overwrite conflicting entries.
 *  - `skip`    — if any conflict exists, abort and change nothing.
 * A "conflict" is a name in both maps with a different source; identical
 * sources are a silent no-op.
 */
export function mergeSkillSources(
  existing: Record<string, string>,
  discovered: Record<string, string>,
  policy: MergePolicy,
): MergeResult {
  const conflicts = Object.keys(discovered).filter(
    (name) => name in existing && existing[name] !== discovered[name],
  );

  if (policy === "skip" && conflicts.length > 0) {
    return { sources: { ...existing }, added: [], overwritten: [], conflicts, aborted: true };
  }

  const sources = { ...existing };
  const added: string[] = [];
  const overwritten: string[] = [];

  for (const [name, src] of Object.entries(discovered)) {
    if (!(name in existing)) {
      sources[name] = src;
      added.push(name);
    } else if (existing[name] !== src && policy === "force") {
      sources[name] = src;
      overwritten.push(name);
    }
  }

  return { sources, added, overwritten, conflicts, aborted: false };
}
