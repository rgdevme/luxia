import fs from "node:fs/promises";
import path from "node:path";
import colors from "yoctocolors-cjs";
import type {
  AgnosConfig,
  CommandSpec,
  DiscoveredSkill,
  Domain,
  ParsedSource,
  ResolveContext,
} from "../../core/index.js";
import {
  buildPaths,
  findSkillsInRepo,
  parseCompositeSkillRef,
  parseSource,
  readConfigOrDefault,
  readSkillMeta,
  skillNameSchema,
  skillRefSchema,
  withSpinner,
  writeConfig,
} from "../../core/index.js";
import {
  MIGRATE_FLAGS,
  multiSelectExclusive,
  policyFromFlags,
  writeChange,
} from "../cli-helpers.js";
import { runSkillPipeline } from "./pipeline.js";
import { mergeSkillSources } from "./migrate.js";
import { createSkillSteps, updateSkills } from "./steps.js";

export * from "./pipeline.js";
export * from "./migrate.js";

const DEFAULT_SKILLS_DIR = "./.agnos/skills";

/**
 * Build the repo-level (subPath-less) source for a `[provider] address` pair.
 * `file` forces local parsing so a bare relative path like `my/dir` isn't
 * mis-read as `owner/repo`; git providers prefix the address so a bare
 * `owner/repo` parses (parseSource, unlike parseCompositeSkillRef, allows no
 * in-repo path = the whole repo, which is what discovery wants).
 */
function repoSource(
  provider: string | undefined,
  address: string,
  projectRoot: string,
): ParsedSource {
  if (provider === "file") return parseSource(`file:${address}`, { projectRoot });
  return parseSource(provider ? `${provider}:${address}` : address, { projectRoot });
}

/**
 * The `--provider` default applies only to addresses that don't already carry
 * their own scheme (`github:…`, `file:…`, `https://…`, `git@…`) or look like a
 * path — those are self-describing and prefixing them would corrupt the spec.
 */
function providerFor(def: string | undefined, address: string): string | undefined {
  if (!def) return undefined;
  if (/^[a-z][a-z0-9+.-]*:/i.test(address) || address.startsWith("git@")) return undefined;
  if (/^(\.\.?\/|\/|[A-Za-z]:[\\/])/.test(address)) return undefined;
  return def;
}

/** A fetched source plus its declaration order on the command line. */
interface Repo {
  address: string;
  source: ParsedSource;
  localRoot: string;
  /** Git ref actually fetched (explicit `#ref` or the resolved default branch). */
  ref?: string;
  /** Index in the original `add a b c` order — the tiebreaker for same-named skills. */
  order: number;
}

/** One discovered skill bound to the repo it came from. */
interface Candidate {
  repo: Repo;
  skill: DiscoveredSkill;
  /** Stored name = the skill directory's own basename (never renamed). */
  name: string;
}

// Effectively uncapped — the description renders on its own line, so it no
// longer needs to fit a single row. Kept as a knob to tune later if needed.
const DESC_MAX = 10000;

/** Origin shown in the picker: `owner/repo` for a git source, else the address given. */
function originLabel(repo: Repo): string {
  return repo.source.kind === "git" ? `${repo.source.owner}/${repo.source.repo}` : repo.address;
}

/**
 * Picker row label (before the checkbox renders the box): the skill name followed
 * by a dimmed `owner/repo` origin. Already-installed skills aren't marked here —
 * they're rendered preselected instead. The description shows on its own line.
 */
function choiceLabel(c: Candidate): string {
  return `${c.name} ${colors.dim(originLabel(c.repo))}`;
}

/** Trim + cap a description for the picker's detail line (capped at {@link DESC_MAX}). */
function capDescription(text: string | undefined): string | undefined {
  const desc = text?.trim();
  if (!desc) return undefined;
  return desc.length > DESC_MAX ? desc.slice(0, DESC_MAX) : desc;
}

/** Sort candidates by skill name (alphabetical), then by repo declaration order. */
function sortCandidates(cands: Candidate[]): Candidate[] {
  return [...cands].sort((a, b) => a.name.localeCompare(b.name) || a.repo.order - b.repo.order);
}

/**
 * Collapse same-named candidates to one — the last declared (highest repo order),
 * matching "alphabet-then-declaration" order's final occurrence. Used by `-y` and
 * `--skills`, where there's no interactive prompt to resolve the collision.
 */
function pickLatestPerName(cands: Candidate[]): Candidate[] {
  const byName = new Map<string, Candidate>();
  for (const c of cands) {
    const prev = byName.get(c.name);
    if (!prev || c.repo.order > prev.repo.order) byName.set(c.name, c);
  }
  return sortCandidates([...byName.values()]);
}

/** Concrete composite ref for a discovered skill — the same shape `add` has always stored. */
function compositeFor(
  source: ParsedSource,
  localRoot: string,
  skillPath: string,
  projectRoot: string,
): string {
  if (source.kind === "git") {
    // The in-repo path slots between repo and the `#<ref>` suffix; re-parse so
    // the result is a normalized canonical ref rather than a hand-spliced one.
    const refSuffix = source.ref ? `#${source.ref}` : "";
    const spec = `${source.provider}:${source.owner}/${source.repo}/${skillPath}${refSuffix}`;
    return parseSource(spec, { projectRoot }).canonical;
  }
  return parseSource(`file:${path.join(localRoot, skillPath)}`, { projectRoot }).canonical;
}

/** Run a single read-only step over every declared skill and report failures. */
async function diagnose(
  which: "fetch" | "version" | "integrity",
  config: AgnosConfig,
  ctx: ResolveContext,
): Promise<void> {
  const sources = config.skills?.sources ?? {};
  if (Object.keys(sources).length === 0) {
    ctx.logger.info("no skills declared");
    return;
  }
  const { steps } = await createSkillSteps(config, ctx);
  const bad: string[] = [];
  for (const [name, composite] of Object.entries(sources)) {
    const f = await steps.fetch(name, composite);
    if (!f.ok || !f.src) {
      if (which === "fetch") bad.push(name);
      continue;
    }
    if (which === "version" && !(await steps.version(name, f.src))) bad.push(name);
    else if (which === "integrity" && !(await steps.integrity(name, f.src))) bad.push(name);
  }
  const label = which === "fetch" ? "moved" : which === "version" ? "outdated" : "changed";
  if (bad.length > 0) ctx.logger.warn(`${which}: ${bad.length} ${label} (${bad.join(", ")})`);
  else ctx.logger.success(`${which}: all skills OK`);
}

const commands: Record<string, CommandSpec> = {
  add: {
    name: "add",
    description: "Add skills from one or more sources; discovers skills and prompts to pick",
    args: [
      {
        name: "skills_address",
        required: true,
        variadic: true,
        description:
          "one or more owner/repo[#ref] (ref defaults to the repo's default branch) or directory paths; each may carry its own provider: prefix",
      },
    ],
    flags: [
      {
        name: "provider",
        type: "string",
        alias: "p",
        description:
          "default provider for addresses without their own prefix (github|gitlab|bitbucket|file)",
      },
      {
        name: "skills",
        type: "string",
        alias: "s",
        description:
          "comma-separated skill names to add, e.g. --skills pdf,docx (skips the prompt)",
      },
    ],
    async run(ctx) {
      const addresses = [...ctx.args];
      if (addresses.length === 0) throw new Error("missing argument <skills_address>");
      const provider = typeof ctx.flags.provider === "string" ? ctx.flags.provider : undefined;
      const filter =
        typeof ctx.flags.skills === "string"
          ? ctx.flags.skills
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined;

      // Fetch every source (in parallel) and discover the skills inside each,
      // keeping provenance (incl. declaration order) so we can build composite
      // refs per origin and break same-name ties deterministically.
      const label = addresses.length === 1 ? addresses[0] : `${addresses.length} sources`;
      const fetchedRepos = await withSpinner(
        `Loading skills from ${label}…`,
        () =>
          Promise.all(
            addresses.map(async (address, order) => {
              const source = repoSource(providerFor(provider, address), address, ctx.projectRoot);
              const fetched = await ctx.fetcher.fetch(source);
              const skills = await findSkillsInRepo(fetched.path);
              const repo: Repo = {
                address,
                source,
                localRoot: fetched.path,
                ...(fetched.ref ? { ref: fetched.ref } : {}),
                order,
              };
              return { repo, skills };
            }),
          ),
        { quiet: ctx.flags.quiet },
      );

      // Flatten to candidates, sorted by skill name then declaration order. A skill
      // is stored under its own name (the directory basename) — never renamed, so
      // we never touch files we don't own. Same-name skills from different sources
      // coexist as candidates; the collision is resolved at selection, not here.
      const candidates = sortCandidates(
        fetchedRepos.flatMap(({ repo, skills }) =>
          skills.map((skill) => ({ repo, skill, name: skill.defaultName })),
        ),
      );
      if (candidates.length === 0) {
        const where = fetchedRepos
          .map(({ repo }) => `${originLabel(repo)}${repo.ref ? `#${repo.ref}` : ""}`)
          .join(", ");
        throw new Error(
          `No skills found in ${where} (looked under the repo's root skills/ directory)`,
        );
      }

      const config = await readConfigOrDefault(ctx.configPath);
      const existing = config.skills?.sources ?? {};

      // Pick the skills to add. Collisions (same name from >1 source) resolve by:
      //   --skills <names> → last declared per name
      //   -y               → last declared per name (every distinct skill)
      //   interactive      → picking one auto-deselects same-named rows
      let chosen: Candidate[];
      if (filter) {
        const wanted = candidates.filter((c) => filter.includes(c.name));
        const found = new Set(wanted.map((c) => c.name));
        const missing = filter.filter((n) => !found.has(n));
        if (missing.length > 0) {
          const available = [...new Set(candidates.map((c) => c.name))].sort().join(", ");
          throw new Error(`skill(s) not found: ${missing.join(", ")}. Available: ${available}`);
        }
        chosen = pickLatestPerName(wanted);
      } else if (ctx.flags.yes) {
        chosen = pickLatestPerName(candidates);
      } else {
        // Preselect a candidate only when it's the exact ref already installed
        // (so at most one row per same-name group starts checked). A same-named
        // skill from a different source stays unchecked — picking it overwrites.
        const isInstalled = (c: Candidate): boolean =>
          existing[c.name] ===
          compositeFor(c.repo.source, c.repo.localRoot, c.skill.path, ctx.projectRoot);
        const anyInstalled = candidates.some(isInstalled);
        const message = anyInstalled
          ? "Select skills to add (already-installed skills are preselected):"
          : "Select skills to add:";
        const choices = candidates.map((c, i) => ({
          name: choiceLabel(c),
          value: String(i),
          group: c.name, // selecting one auto-deselects same-named candidates
          checked: isInstalled(c),
          ...(capDescription(c.skill.description)
            ? { description: capDescription(c.skill.description)! }
            : {}),
        }));
        const picked = await multiSelectExclusive(
          ctx,
          message,
          choices,
          "pass --skills <names> or -y to install all, or run in a terminal to pick interactively",
        );
        if (picked.length === 0) {
          ctx.logger.info("nothing selected");
          return;
        }
        chosen = picked.map((i) => candidates[Number(i)]!);
      }

      // Expand each pick into a concrete per-skill composite ref. Storage shape
      // is one entry per skill name — an already-declared name is overwritten.
      const sources = { ...existing };
      const added: string[] = [];
      for (const { repo, skill, name } of chosen) {
        const named = skillNameSchema.safeParse(name);
        if (!named.success) {
          throw new Error(
            `"${name}" (from ${skill.path} in ${repo.address}) is not a valid skill name; ` +
              `the skill directory name must be alphanumeric/dash`,
          );
        }
        const composite = compositeFor(repo.source, repo.localRoot, skill.path, ctx.projectRoot);
        // Defensive: the stored value must parse back to a concrete skill ref.
        parseCompositeSkillRef(composite, { projectRoot: ctx.projectRoot });
        sources[named.data] = composite;
        added.push(`${named.data} → ${composite}`);
      }

      await writeChange(ctx, `added ${added.length} skill(s): ${added.join(", ")}`, {
        ...config,
        skills: { ...config.skills, sources },
      });
    },
  },
  remove: {
    name: "remove",
    description: "Remove skill sources (multiselect prompt when no name is given)",
    args: [
      {
        name: "names",
        required: false,
        variadic: true,
        description: "skills to remove (omit to pick)",
      },
    ],
    async run(ctx) {
      const config = await readConfigOrDefault(ctx.configPath);
      const all = config.skills?.sources ?? {};
      const declared = Object.keys(all);
      if (declared.length === 0) {
        ctx.logger.info("no skills to remove");
        return;
      }

      let targets = ctx.args;
      if (targets.length === 0) {
        // Same look as `add`: skill name, then a dimmed ref, with the installed
        // skill's description (best-effort) on its own line.
        const skillsDir = buildPaths(ctx.projectRoot, config).skillsDir;
        const choices = await Promise.all(
          declared.map(async (n) => {
            const { description } = await readSkillMeta(path.join(skillsDir, n, "SKILL.md"));
            const desc = capDescription(description);
            return {
              name: `${n} ${colors.dim(all[n]!)}`,
              value: n,
              ...(desc ? { description: desc } : {}),
            };
          }),
        );
        targets = await multiSelectExclusive(
          ctx,
          "Select skills to remove:",
          choices,
          "specify skill name(s) to remove, or run in a terminal to pick them",
        );
      }

      if (targets.length === 0) {
        ctx.logger.info("nothing selected");
        return;
      }
      const missing = targets.filter((n) => !(n in all));
      if (missing.length > 0) throw new Error(`skill(s) not found: ${missing.join(", ")}`);

      const sources = Object.fromEntries(Object.entries(all).filter(([n]) => !targets.includes(n)));
      await writeChange(ctx, `removed ${targets.length} skill(s): ${targets.join(", ")}`, {
        ...config,
        skills: { ...config.skills, sources },
      });
    },
  },
  fetch: {
    name: "fetch",
    description: "Check that every skill source still resolves (reports moved)",
    async run(ctx) {
      await diagnose("fetch", await readConfigOrDefault(ctx.configPath), ctx);
    },
  },
  version: {
    name: "version",
    description: "Check whether skills are on their pinned commit (reports outdated)",
    async run(ctx) {
      await diagnose("version", await readConfigOrDefault(ctx.configPath), ctx);
    },
  },
  integrity: {
    name: "integrity",
    description: "Verify skill content matches the lock (reports changed)",
    async run(ctx) {
      await diagnose("integrity", await readConfigOrDefault(ctx.configPath), ctx);
    },
  },
  install: {
    name: "install",
    description: "Run the prep pipeline (fetch → version → integrity → install)",
    async run(ctx) {
      const config = await readConfigOrDefault(ctx.configPath);
      const sources = config.skills?.sources ?? {};
      if (Object.keys(sources).length === 0) {
        ctx.logger.info("no skills declared");
        return;
      }
      const handle = await createSkillSteps(config, ctx);
      const res = await runSkillPipeline(sources, handle.steps, ctx.logger);
      await handle.flush();
      if (res.installed.length > 0)
        ctx.logger.success(`installed ${res.installed.length} skill(s)`);
    },
  },
  update: {
    name: "update",
    description: "Re-pin + reinstall skills, accepting upstream changes",
    args: [
      { name: "names", required: false, variadic: true, description: "skills (default: all)" },
    ],
    async run(ctx) {
      const config = await readConfigOrDefault(ctx.configPath);
      const updated = await updateSkills(ctx.args, config, ctx);
      ctx.logger.success(`updated ${updated.length} skill(s)${ctx.dryRun ? " (dry)" : ""}`);
    },
  },
  migrate: {
    name: "migrate",
    description: "Import skill sources from a lock file (name → ref JSON)",
    args: [{ name: "file", required: false, description: "lock file (default skills-lock.json)" }],
    flags: MIGRATE_FLAGS,
    async run(ctx) {
      const file = ctx.args[0] ?? "skills-lock.json";
      let raw: string;
      try {
        raw = await fs.readFile(path.resolve(ctx.projectRoot, file), "utf8");
      } catch {
        throw new Error(`cannot read ${file}`);
      }
      let data: unknown;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error(`${file} is not valid JSON`);
      }
      const map =
        data && typeof data === "object" && "skills" in data
          ? (data as { skills: unknown }).skills
          : data;
      const discovered: Record<string, string> = {};
      for (const [name, ref] of Object.entries((map ?? {}) as Record<string, unknown>)) {
        if (typeof ref !== "string") continue;
        if (!skillNameSchema.safeParse(name).success || !skillRefSchema.safeParse(ref).success) {
          ctx.logger.warn(`skipping invalid skill "${name}"`);
          continue;
        }
        discovered[name] = ref;
      }
      const config = await readConfigOrDefault(ctx.configPath);
      const res = mergeSkillSources(config.skills?.sources ?? {}, discovered, policyFromFlags(ctx));
      if (res.aborted) {
        throw new Error(
          `skills migrate aborted: ${res.conflicts.length} conflict(s). Re-run with --force or --missing.`,
        );
      }
      await writeChange(
        ctx,
        `skills migrate: +${res.added.length} added, ${res.overwritten.length} overwritten`,
        { ...config, skills: { ...config.skills, sources: res.sources } },
      );
    },
  },
};

/**
 * The skills domain: a config writer that also prepares the canonical skill
 * bytes. `run` executes the offline prep pipeline (fetch → integrity → install)
 * over every declared skill, bucketing failures as moved/changed and installing
 * the clean ones into `.agnos/skills/` (linked per-agent by the agents domain).
 * Warm runs reuse the locked ref + cache and make no network calls; the network
 * freshness check lives in the `version`/`update` subcommands. The
 * `fetch`/`version`/`integrity`/`install`/`update`/`migrate` subcommands expose
 * the same engine; data layer in pipeline.ts / migrate.ts / steps.ts.
 */
export const skillsDomain: Domain = {
  id: "skills",
  description: "Fetch + verify skills into the canonical skills dir (linked per-agent by agents)",
  kind: "writer",
  priority: 10,
  commands,
  initSteps: [
    {
      id: "route",
      type: "text",
      message: "Canonical skills directory (relative to project root):",
      default: DEFAULT_SKILLS_DIR,
      async callback(value, ctx) {
        const route = value.trim() || DEFAULT_SKILLS_DIR;
        const config = (await readConfigOrDefault(ctx.configPath)) as AgnosConfig;
        const skills = { ...(config.skills ?? {}) };
        if (route === DEFAULT_SKILLS_DIR) delete skills.route;
        else skills.route = route;
        const next: AgnosConfig = { ...config, skills };
        if (ctx.dryRun) {
          ctx.logger.info(`would: set skills.route = ${route}`);
          return;
        }
        await writeConfig(ctx.configPath, next);
        await fs.mkdir(buildPaths(ctx.projectRoot, next).skillsDir, { recursive: true });
      },
    },
  ],
  async run(_opts, ctx) {
    const config = await readConfigOrDefault(ctx.configPath);
    const sources = config.skills?.sources ?? {};
    // No skill sources declared → nothing to fetch/verify.
    if (Object.keys(sources).length === 0) return undefined;
    // Run the offline prep pipeline (fetch → integrity → install). Failures are
    // bucketed and reported as "Skills need to be updated: …" without throwing,
    // so the overall run continues (§13.1).
    const handle = await createSkillSteps(config, ctx);
    await runSkillPipeline(sources, handle.steps, ctx.logger);
    await handle.flush();
    return undefined;
  },
};

export default skillsDomain;
