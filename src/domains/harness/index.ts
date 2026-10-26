import path from "node:path";
import fs from "node:fs/promises";
import type {
  HarnessAdapter,
  AgnosConfig,
  CommandContext,
  CommandSpec,
  Domain,
  ExclusiveChoice,
  MaterializeContext,
  ResolveContext,
  ResolvedMcp,
  SkillMetadataDiagnostic,
} from "../../core/index.js";
import { readConfigOrDefault, validateSkillForHarnesses, writeConfig } from "../../core/index.js";
import {
  harnessById,
  HARNESS_ADAPTERS,
  DEFAULT_HARNESS_IDS,
} from "../../harnesses/adapters/index.js";
import { removePaths } from "../../harnesses/adapters/shared.js";
import { multiSelectInteractive, writeChange } from "../cli-helpers.js";
import { resolveMcpServers } from "./mcp-env.js";
import { resolveSkillTargets } from "../skills/steps.js";

const ADD_HINT =
  "pass harness ids to add (e.g. `agnos harness add claude-code`) — interactive selection needs a TTY";
const REMOVE_HINT =
  "pass harness ids to remove (e.g. `agnos harness remove codex`) — interactive selection needs a TTY";

const HARNESSES_ARG = {
  name: "harness",
  required: false,
  variadic: true,
  description: "harness ids (claude-code | codex | gemini-cli); omit to pick interactively",
} as const;

function harnessDescription(adapter: HarnessAdapter): string | undefined {
  const file = adapter.paths?.rulesFilename;
  return file ? `writes ${file}` : undefined;
}

function unknownAgentError(ids: string[]): Error {
  const plural = ids.length > 1 ? "s" : "";
  return new Error(
    `unknown harness${plural} "${ids.join(", ")}" (known: ${HARNESS_ADAPTERS.map((a) => a.id).join(", ")})`,
  );
}

/** The per-harness render slices, in dependency order. */
const SLICES = ["rules", "mcp", "skills"] as const;

async function warnSkillMetadata(
  config: AgnosConfig,
  harnesses: readonly HarnessAdapter[],
  ctx: CommandContext | ResolveContext,
): Promise<void> {
  const localRoot = config.skills?.dir ?? ".agnos/skills";
  const localDirectory = path.isAbsolute(localRoot)
    ? localRoot
    : path.resolve(ctx.projectRoot, localRoot);
  const skillDirectories = new Map<string, string>();
  const localSkills = await fs.readdir(localDirectory, { withFileTypes: true }).catch(() => []);
  for (const entry of localSkills) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(localDirectory, entry.name);
    try {
      await fs.access(path.join(directory, "SKILL.md"));
      skillDirectories.set(entry.name, directory);
    } catch {
      continue;
    }
  }
  for (const harness of harnesses) {
    const skillsDir = harness.paths?.skillsDir;
    if (!skillsDir) continue;
    const root = path.resolve(ctx.projectRoot, skillsDir);
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (skillDirectories.has(entry.name)) continue;
      const directory = path.join(root, entry.name);
      try {
        await fs.access(path.join(directory, "SKILL.md"));
        skillDirectories.set(entry.name, await fs.realpath(directory));
      } catch {
        continue;
      }
    }
  }
  for (const [name, directory] of skillDirectories) {
    const findings = await validateSkillForHarnesses(name, directory, harnesses);
    for (const finding of findings) {
      ctx.logger.warn({
        message: `${finding.harnessId}: skill "${finding.skillName}" ${finding.message}`,
        status: finding.file,
      });
    }
  }
}

/**
 * Resolve the per-slice state the adapters render from. Reads the new-schema
 * config directly — this is the config-READER half of the writer/reader split.
 */
export function resolveSlices(config: AgnosConfig, _ctx: ResolveContext): Record<string, unknown> {
  return {
    rules: Object.keys(config.rules?.fragments ?? {}),
    mcp: (config.mcp?.servers ?? []).map((m) => ({ ...m })) as ResolvedMcp[],
    skills: {},
  };
}

async function resolveSlice(
  slice: (typeof SLICES)[number],
  adapter: HarnessAdapter,
  config: AgnosConfig,
  ctx: MaterializeContext,
): Promise<unknown> {
  if (slice === "mcp") return await resolveMcpServers(config.mcp, ctx);
  if (slice === "skills") {
    const targets = await resolveSkillTargets(config, ctx);
    for (const [name, directory] of Object.entries(targets)) {
      const findings: SkillMetadataDiagnostic[] = await validateSkillForHarnesses(name, directory, [
        adapter,
      ]);
      for (const finding of findings) {
        ctx.logger.warn({
          message: `${finding.harnessId}: skill "${finding.skillName}" ${finding.message}`,
          status: finding.file,
        });
      }
    }
    return targets;
  }
  return resolveSlices(config, ctx)[slice];
}

/** Active harness adapters from `agnos.json#harness` (unknown ids warn and skip). */
export function activeHarnesses(config: AgnosConfig, ctx: ResolveContext): HarnessAdapter[] {
  const out: HarnessAdapter[] = [];
  for (const ref of config.harness ?? []) {
    const adapter = harnessById(ref);
    if (adapter) out.push(adapter);
    else ctx.logger.warn({ message: `unknown harness "${ref}"`, status: "skipped" });
  }
  return out;
}

/**
 * Render one harness. A slice failure warns with the reason and continues to
 * the next slice; it never aborts the harness or the run.
 */
export async function renderHarness(
  adapter: HarnessAdapter,
  config: AgnosConfig,
  ctx: MaterializeContext,
): Promise<void> {
  for (const slice of SLICES) {
    const fn = adapter.render?.[slice];
    if (!fn) continue;
    try {
      await fn(await resolveSlice(slice, adapter, config, ctx), ctx);
    } catch (err) {
      ctx.logger.warn(`${adapter.id}: ${slice} render failed: ${(err as Error).message}`);
    }
  }
}

/**
 * Remove a harness's owned outputs on deactivation. Deletes only the
 * removed harness's claimed paths that no remaining harness also claims (shared
 * artifacts are kept). Canonical files are never claimed, so never deleted here.
 */
export async function cleanupHarness(
  removed: HarnessAdapter,
  remaining: readonly HarnessAdapter[],
  ctx: MaterializeContext,
): Promise<void> {
  await removed.cleanup?.(ctx);
  const owned = removed.claims ? await removed.claims(ctx) : [];
  const kept = new Set<string>();
  for (const r of remaining) {
    if (!r.claims) continue;
    for (const p of await r.claims(ctx)) kept.add(path.resolve(p));
  }
  const toRemove = owned.filter((p) => !kept.has(path.resolve(p)));
  await removePaths(toRemove, ctx);
}

/** Scrape a slice from each active harness for explicit configuration import. */
export async function scrapeActiveHarnesses(slice: "mcp", ctx: CommandContext): Promise<unknown[]> {
  const config = await readConfigOrDefault(ctx.configPath);
  const out: unknown[] = [];
  for (const adapter of activeHarnesses(config, ctx)) {
    const fn = adapter.scrape?.[slice];
    if (!fn) continue;
    const got = await fn({ ...ctx, harnessId: adapter.id, indent: "" });
    if (Array.isArray(got)) out.push(...got);
  }
  return out;
}

const commands: Record<string, CommandSpec> = {
  add: {
    name: "add",
    description: "Enable harnesses (their files render on the next `agnos` run)",
    args: [HARNESSES_ARG],
    async run(ctx) {
      const config = await readConfigOrDefault(ctx.configPath);
      const enabled = config.harness ?? [];
      let ids = ctx.args;
      if (ids.length === 0) {
        if (HARNESS_ADAPTERS.every((a) => enabled.includes(a.id))) {
          ctx.logger.info("all harnesses are already enabled");
          return;
        }
        // Already-enabled harnesses show dimmed and locked so the picker stays additive.
        const choices: ExclusiveChoice[] = HARNESS_ADAPTERS.map((a) => ({
          name: a.displayName,
          value: a.id,
          description: harnessDescription(a),
          checked: enabled.includes(a.id),
          disabled: enabled.includes(a.id),
        }));
        ids = await multiSelectInteractive("Add harnesses:", choices, ADD_HINT);
      }
      const unknown = ids.filter((id) => !harnessById(id));
      if (unknown.length > 0) throw unknownAgentError(unknown);
      const toAdd = [...new Set(ids)].filter((id) => !enabled.includes(id));
      if (toAdd.length === 0) {
        ctx.logger.info("nothing to add");
        return;
      }
      const plural = toAdd.length > 1 ? "s" : "";
      await writeChange(ctx, `enabled harness${plural} "${toAdd.join(", ")}"`, {
        ...config,
        harness: [...enabled, ...toAdd],
      });
      await warnSkillMetadata(
        config,
        toAdd
          .map((id) => harnessById(id))
          .filter((adapter): adapter is HarnessAdapter => !!adapter),
        ctx,
      );
    },
  },
  remove: {
    name: "remove",
    description: "Remove harness-owned files, then disable the harnesses",
    args: [HARNESSES_ARG],
    async run(ctx) {
      const config = await readConfigOrDefault(ctx.configPath);
      const enabled = config.harness ?? [];
      let ids = ctx.args;
      if (ids.length === 0) {
        if (enabled.length === 0) {
          ctx.logger.info("no harnesses are enabled");
          return;
        }
        const choices: ExclusiveChoice[] = enabled.map((id) => {
          const adapter = harnessById(id);
          return {
            name: adapter?.displayName ?? id,
            value: id,
            description: adapter ? harnessDescription(adapter) : undefined,
          };
        });
        ids = await multiSelectInteractive("Remove harnesses:", choices, REMOVE_HINT);
      }
      const targets = [...new Set(ids)];
      if (targets.length === 0) return;
      const notEnabled = targets.filter((id) => !enabled.includes(id));
      if (notEnabled.length > 0) throw new Error(`not enabled: ${notEnabled.join(", ")}`);
      // Delete each removed harness's owned files first, then edit the config.
      const remaining = enabled
        .filter((id) => !targets.includes(id))
        .map((id) => harnessById(id))
        .filter((a): a is HarnessAdapter => Boolean(a));
      for (const id of targets) {
        const removed = harnessById(id);
        if (removed)
          await cleanupHarness(removed, remaining, { ...ctx, harnessId: id, indent: "  " });
      }
      const plural = targets.length > 1 ? "s" : "";
      await writeChange(ctx, `removed harness${plural} "${targets.join(", ")}"`, {
        ...config,
        harness: enabled.filter((id) => !targets.includes(id)),
      });
    },
  },
};

/**
 * The harness domain: the sole config-reader. Highest priority so it renders
 * after every writer domain has produced its canonical outputs. `add`/`remove`
 * toggle `agnos.json#harness` (remove also cleans harness-owned files); `run`
 * renders every active harness.
 */
export const harnessDomain: Domain = {
  id: "harness",
  description: "Render per-harness native files from agnos.json (the config reader)",
  kind: "reader",
  priority: 99,
  color: "gray",
  initSteps: [
    {
      id: "select",
      type: "multiselect",
      message: "Which harnesses do you want to configure?",
      choices: HARNESS_ADAPTERS.map((a) => ({
        name: a.displayName,
        value: a.id,
        description: harnessDescription(a),
      })),
      // Pre-check the current selection; on a fresh project fall back to the
      // curated default. Also the value written non-interactively (`-y`/`--dry`).
      default: async (ctx) => {
        const config = await readConfigOrDefault(ctx.configPath);
        const harness = config.harness ?? [];
        return harness.length > 0 ? harness : [...DEFAULT_HARNESS_IDS];
      },
      async callback(ids, ctx) {
        const config = await readConfigOrDefault(ctx.configPath);
        await writeConfig(ctx.configPath, { ...config, harness: [...new Set(ids)] });
        await warnSkillMetadata(
          config,
          ids
            .map((id) => harnessById(id))
            .filter((adapter): adapter is HarnessAdapter => !!adapter),
          ctx,
        );
      },
    },
  ],
  commands,
  async run(opts, ctx) {
    const config = await readConfigOrDefault(ctx.configPath);
    const adapters = activeHarnesses(config, ctx);
    if (adapters.length === 0) return undefined;
    for (const adapter of adapters) {
      await ctx.logger.info({
        message: `Materializing ${adapter.displayName} harness files`,
        waitFor: renderHarness(adapter, config, { ...ctx, harnessId: adapter.id, indent: "  " }),
      });
    }
    return undefined;
  },
  // The config reader re-renders whenever agnos.json changes — that is where the
  // active harnesses, skills, mcp, and rules-file list it materializes live.
  watchPaths(_config, ctx) {
    return [ctx.configPath];
  },
};

export { HARNESS_ADAPTERS };
