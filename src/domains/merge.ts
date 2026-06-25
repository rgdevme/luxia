/** Conflict-resolution policy shared by the array-valued domains (mcp, hooks). */
export type MergePolicy = "missing" | "force" | "skip";

export interface ArrayMergeResult<T> {
  items: T[];
  added: number;
  overwritten: number;
  conflicts: number;
  /** True when `skip` aborted because a conflict existed (items unchanged). */
  aborted: boolean;
}

/**
 * Reconcile discovered array items into an existing array, keyed by `identity`:
 *  - `missing` — append only items whose identity is absent.
 *  - `force`   — append missing AND overwrite items whose identity matches but
 *                whose payload differs.
 *  - `skip`    — if any identity matches with a differing payload, abort.
 * A "conflict" is a matching identity with a differing payload (per `equal`);
 * identical payloads are a silent no-op.
 */
export function mergeByIdentity<T>(
  existing: T[],
  discovered: T[],
  identity: (item: T) => string,
  equal: (a: T, b: T) => boolean,
  policy: MergePolicy,
): ArrayMergeResult<T> {
  const index = new Map(existing.map((e) => [identity(e), e]));
  const conflicts = discovered.filter((d) => {
    const e = index.get(identity(d));
    return e !== undefined && !equal(e, d);
  });

  if (policy === "skip" && conflicts.length > 0) {
    return {
      items: [...existing],
      added: 0,
      overwritten: 0,
      conflicts: conflicts.length,
      aborted: true,
    };
  }

  const items = [...existing];
  let added = 0;
  let overwritten = 0;
  for (const d of discovered) {
    const id = identity(d);
    const idx = items.findIndex((e) => identity(e) === id);
    if (idx < 0) {
      items.push(d);
      added++;
    } else if (!equal(items[idx]!, d) && policy === "force") {
      items[idx] = d;
      overwritten++;
    }
  }
  return { items, added, overwritten, conflicts: conflicts.length, aborted: false };
}

/** Structural equality via stable stringify (sufficient for plain declarations). */
export function jsonEqual<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
