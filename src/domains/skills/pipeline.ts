import type { Logger } from "../../core/index.js";
import { runSkillTasks } from "./concurrency.js";

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
  /** Commit SHA of the fetched repository checkout. */
  commit?: string;
  /** Whether the skill came from the content store or its declared source. */
  source?: "reused" | "fetched";
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
  install(name: string, src: string, ref?: string, commit?: string): Promise<void>;
}

export interface PipelineResult {
  buckets: Record<Bucket, string[]>;
  installed: string[];
  progress: SkillInstallProgress;
}

/** Aggregate progress counters for one skill installation pipeline. */
export interface SkillInstallProgress {
  /** Number of declared skills examined by the pipeline. */
  total: number;
  /** Number of skills whose pipeline has completed. */
  completed: number;
  /** Number restored from the content-addressed skill store. */
  reused: number;
  /** Number loaded from their declared source. */
  fetched: number;
}

interface SkillResult {
  bucket?: Bucket;
  installed?: string;
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

  const entries = Object.entries(sources);
  const state: SkillInstallProgress = {
    total: entries.length,
    completed: 0,
    reused: 0,
    fetched: 0,
  };
  const progress = logger.progress(formatSkillProgress(state));
  let results: SkillResult[];
  try {
    results = await runSkillTasks(entries, async ([name, ref]) => {
      const fetched = await steps.fetch(name, ref);
      let result: SkillResult;
      if (!fetched.ok || !fetched.src) {
        result = { bucket: "moved" };
      } else if (!(await steps.integrity(name, fetched.src))) {
        result = { bucket: "changed" };
      } else {
        await steps.install(name, fetched.src, fetched.ref, fetched.commit);
        result = { installed: name };
      }
      recordSkillProgress(state, fetched.source, progress);
      return result;
    });
  } finally {
    progress.stop();
  }

  for (const [index, result] of results.entries()) {
    const entry = entries[index];
    if (!entry) continue;
    const [name] = entry;
    if (result.bucket) buckets[result.bucket].push(name);
    if (result.installed) installed.push(result.installed);
  }

  const total = buckets.moved.length + buckets.changed.length;
  if (total > 0) {
    logger.warn({
      message: `skills need updating: ${buckets.moved.length} moved, ${buckets.changed.length} changed`,
      extra: "run: agnos skills update",
    });
  }
  return { buckets, installed, progress: state };
}

function formatSkillProgress(progress: SkillInstallProgress): {
  message: string;
  status: string;
} {
  const percentage =
    progress.total === 0 ? 100 : Math.floor((progress.completed / progress.total) * 100);
  return {
    message: `Installing skills ${percentage}%`,
    status: `total ${progress.total} | reused ${progress.reused} | fetched ${progress.fetched}`,
  };
}

function recordSkillProgress(
  progress: SkillInstallProgress,
  source: FetchResult["source"],
  reporter: { update(input: { message: string; status: string }): void },
): void {
  progress.completed += 1;
  if (source === "reused") progress.reused += 1;
  else if (source === "fetched") progress.fetched += 1;
  reporter.update(formatSkillProgress(progress));
}
