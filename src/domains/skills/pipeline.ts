import type { Logger } from "../../core/index.js";

/**
 * Per-skill preparation buckets. A skill lands in exactly one — the pipeline
 * short-circuits on the first failing step in precedence order
 * `fetch → version → integrity → install`, so a skill that is both outdated and
 * changed is reported as `outdated` (version runs before integrity).
 */
export type Bucket = "moved" | "changed" | "outdated";

export interface FetchResult {
  ok: boolean;
  /** Absolute path to the fetched skill content (when ok). */
  src?: string;
}

/**
 * The four separable steps. Each is its own CLI subcommand (`agnos skills
 * fetch|version|integrity|install`) and they compose into the prep pipeline.
 */
export interface SkillSteps {
  /** Resolve + locate the skill; ok=false → "moved" (source moved/removed). */
  fetch(name: string, ref: string): Promise<FetchResult>;
  /** Is the resolved commit still upstream's latest? false → "outdated". */
  version(name: string, src: string): Promise<boolean>;
  /** Does the content hash match the lock? false → "changed". */
  integrity(name: string, src: string): Promise<boolean>;
  /** Copy into the canonical dir (copy-if-absent-or-changed). */
  install(name: string, src: string): Promise<void>;
}

export interface PipelineResult {
  buckets: Record<Bucket, string[]>;
  installed: string[];
}

/**
 * Run the prep pipeline over `sources` (name → composite ref). Per skill, runs
 * the steps in precedence order, short-circuiting on the first failure into a
 * single bucket; otherwise installs. Aggregates failures into one warning and
 * halts before reporting installed when anything needs updating.
 */
export async function runSkillPipeline(
  sources: Record<string, string>,
  steps: SkillSteps,
  logger: Logger,
): Promise<PipelineResult> {
  const buckets: Record<Bucket, string[]> = { moved: [], changed: [], outdated: [] };
  const installed: string[] = [];

  for (const [name, ref] of Object.entries(sources)) {
    const fetched = await steps.fetch(name, ref);
    if (!fetched.ok || !fetched.src) {
      buckets.moved.push(name);
      continue;
    }
    if (!(await steps.version(name, fetched.src))) {
      buckets.outdated.push(name);
      continue;
    }
    if (!(await steps.integrity(name, fetched.src))) {
      buckets.changed.push(name);
      continue;
    }
    await steps.install(name, fetched.src);
    installed.push(name);
  }

  const total = buckets.moved.length + buckets.changed.length + buckets.outdated.length;
  if (total > 0) {
    logger.warn(
      `Skills need to be updated: ${buckets.moved.length} moved   ` +
        `${buckets.changed.length} changed   ${buckets.outdated.length} outdated\n` +
        `Please run: agnos skills update`,
    );
  }
  return { buckets, installed };
}
