import fs from "node:fs/promises";
import path from "node:path";
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
  dim,
  findSkillsInRepo,
  parseCompositeSkillRef,
  parseSource,
  readConfigOrDefault,
  skillNameSchema,
  skillRefSchema,
  withSpinner,
  writeConfig,
} from "../../core/index.js";
import { MIGRATE_FLAGS, multiSelect, policyFromFlags, writeChange } from "../cli-helpers.js";
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

/** Owner segment used to namespace a skill's stored name: git owner, else the source dir name. */
function ownerPrefix(source: ParsedSource): string {
  return source.kind === "git" ? source.owner : path.basename(source.absolutePath);
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
      // keeping provenance so we can namespace + build composite refs per origin.
      interface Repo {
        address: string;
        source: ParsedSource;
        localRoot: string;
      }
      interface Candidate {
        repo: Repo;
        skill: DiscoveredSkill;
        name: string;
      }
      const label = addresses.length === 1 ? addresses[0] : `${addresses.length} sources`;
      const fetchedRepos = await withSpinner(
        `Loading skills from ${label}…`,
        () =>
          Promise.all(
            addresses.map(async (address) => {
              const source = repoSource(providerFor(provider, address), address, ctx.projectRoot);
              const fetched = await ctx.fetcher.fetch(source);
              const skills = await findSkillsInRepo(fetched.path);
              const repo: Repo = { address, source, localRoot: fetched.path };
              return { repo, skills };
            }),
          ),
        { quiet: ctx.flags.quiet },
      );

      // Flatten to candidates, namespacing each stored name as `<owner>-<skill>`.
      const candidates: Candidate[] = fetchedRepos.flatMap(({ repo, skills }) =>
        skills.map((skill) => ({
          repo,
          skill,
          name: `${ownerPrefix(repo.source)}-${skill.defaultName}`,
        })),
      );
      if (candidates.length === 0) {
        throw new Error(
          `no skills found under ${addresses.join(", ")} (looked for SKILL.md in the source)`,
        );
      }

      const config = await readConfigOrDefault(ctx.configPath);
      const existing = config.skills?.sources ?? {};

      // Pick the skills to add: explicit --skills filter, --yes (all), else prompt.
      let chosen: Candidate[];
      if (filter) {
        chosen = candidates.filter((c) => filter.includes(c.skill.defaultName));
        const found = new Set(chosen.map((c) => c.skill.defaultName));
        const missing = filter.filter((n) => !found.has(n));
        if (missing.length > 0) {
          const available = [...new Set(candidates.map((c) => c.skill.defaultName))].join(", ");
          throw new Error(`skill(s) not found: ${missing.join(", ")}. Available: ${available}`);
        }
      } else if (ctx.flags.yes) {
        chosen = candidates;
      } else {
        const anyInstalled = candidates.some((c) => c.name in existing);
        const message = anyInstalled
          ? "Select skills to add:\n[!] already installed — selecting overwrites it."
          : "Select skills to add:";
        const multiRepo = addresses.length > 1;
        const choices = candidates.map((c, i) => {
          const desc = c.skill.description?.trim();
          const blurb = desc ? " " + dim(desc.length > 60 ? `${desc.slice(0, 60)}…` : desc) : "";
          const origin = multiRepo ? dim(` (${c.repo.address})`) : "";
          const text = `${c.name}${origin}${blurb}`;
          return { name: c.name in existing ? `[!] ${text}` : text, value: String(i) };
        });
        const picked = await multiSelect(
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
      // is identical to before — one entry per skill — so installs stay reproducible.
      const sources = { ...existing };
      const added: string[] = [];
      const seen = new Map<string, string>(); // stored name → origin address
      for (const { repo, skill, name } of chosen) {
        const named = skillNameSchema.safeParse(name);
        if (!named.success) {
          throw new Error(
            `"${name}" (from ${skill.path} in ${repo.address}) is not a valid skill name; ` +
              `owner and skill directory names must be alphanumeric/dash`,
          );
        }
        const prior = seen.get(named.data);
        if (prior) {
          throw new Error(
            `skill name "${named.data}" resolves from both ${prior} and ${repo.address}; ` +
              `add them in separate runs to avoid one silently overwriting the other`,
          );
        }
        seen.set(named.data, repo.address);
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
        targets = await multiSelect(
          ctx,
          "Select skills to remove:",
          declared.map((n) => ({ name: `${n}  (${all[n]})`, value: n })),
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
 * bytes. `run` executes the prep pipeline (fetch → version → integrity →
 * install) over every declared skill, bucketing failures as moved/changed/
 * outdated and installing the clean ones into `.agnos/skills/` (linked per-agent
 * by the agents domain). The `fetch`/`version`/`integrity`/`install`/`update`/
 * `migrate` subcommands expose the same engine; data layer in pipeline.ts /
 * migrate.ts / steps.ts.
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
    // Run the prep pipeline (fetch → version → integrity → install). Failures are
    // bucketed and reported as "Skills need to be updated: …" without throwing,
    // so the overall run continues (§13.1).
    const handle = await createSkillSteps(config, ctx);
    await runSkillPipeline(sources, handle.steps, ctx.logger);
    await handle.flush();
    return undefined;
  },
};

export default skillsDomain;
