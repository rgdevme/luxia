import type { Logger } from "../../core/index.js";

/**
 * Per-skill preparation buckets. A skill lands in exactly one — the pipeline
 * short-circuits on the first failing step in precedence order
 * `fetch → integrity → install`. Upstream-freshness ("outdated") is deliberately
 * not checked here: the run pipeline materializes the locked, cached content
 * offline. Use `agnos skills version` / `update` for the network freshness check.
 */
export type Bucket = "moved" | "changed";

export interface FetchResult {
  ok: boolean;
  /** Absolute path to the fetched skill content (when ok). */
  src?: string;
  /** Branch/tag actually fetched (git sources) — threaded to `install` for the lock. */
  ref?: string;
}

/**
 * The four separable steps. Each is its own CLI subcommand (`agnos skills
 * fetch|version|integrity|install`) and they compose into the prep pipeline.
 */
export interface SkillSteps {
  /** Resolve + locate the skill; ok=false → "moved" (source moved/removed). */
  fetch(name: string, ref: string): Promise<FetchResult>;
  /**
   * Is the resolved commit still upstream's latest? false → "outdated". Network
   * call — used by the explicit `agnos skills version` diagnostic, not the run.
   */
  version(name: string, src: string): Promise<boolean>;
  /** Does the content hash match the lock? false → "changed". */
  integrity(name: string, src: string): Promise<boolean>;
  /** Copy into the canonical dir (copy-if-absent-or-changed); pins/backfills the lock. */
  install(name: string, src: string, ref?: string): Promise<void>;
}

export interface PipelineResult {
  buckets: Record<Bucket, string[]>;
  installed: string[];
}

/**
 * Run the prep pipeline over `sources` (name → composite ref). Per skill, runs
 * `fetch → integrity → install`, short-circuiting on the first failure into a
 * single bucket; otherwise installs. Offline by design: warm runs reuse the
 * locked ref + cached content and never touch the network. Aggregates failures
 * into one warning pointing at `agnos skills update`.
 */
export async function runSkillPipeline(
  sources: Record<string, string>,
  steps: SkillSteps,
  logger: Logger,
): Promise<PipelineResult> {
  const buckets: Record<Bucket, string[]> = { moved: [], changed: [] };
  const installed: string[] = [];

  for (const [name, ref] of Object.entries(sources)) {
    const fetched = await steps.fetch(name, ref);
    if (!fetched.ok || !fetched.src) {
      buckets.moved.push(name);
      continue;
    }
    if (!(await steps.integrity(name, fetched.src))) {
      buckets.changed.push(name);
      continue;
    }
    await steps.install(name, fetched.src, fetched.ref);
    installed.push(name);
  }

  const total = buckets.moved.length + buckets.changed.length;
  if (total > 0) {
    logger.warn(
      `Skills need to be updated: ${buckets.moved.length} moved   ` +
        `${buckets.changed.length} changed\n` +
        `Please run: agnos skills update`,
    );
  }
  return { buckets, installed };
}
