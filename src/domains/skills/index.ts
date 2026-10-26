import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import colors from "yoctocolors-cjs";
import { HARNESS_ADAPTERS } from "../../harnesses/adapters/index.js";
import type {
  AgnosConfig,
  CommandContext,
  CommandSpec,
  DiscoveredSkill,
  Domain,
  HarnessAdapter,
  ParsedSource,
  RepositoryRequest,
} from "../../core/index.js";
import {
  DEFAULT_LOCAL_SKILLS_DIR,
  findSkillsInRepo,
  parseCompositeSkillRef,
  skillRequestKey,
  parseSource,
  readConfigOrDefault,
  readSkillMeta,
  skillNameSchema,
  writeConfig,
  readLock,
  removeSkill,
  writeLock,
  ensureLink,
  validateSkillForHarnesses,
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
  trackingId?: string;
  consumerName?: string;
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

function configuredHarnesses(config: AgnosConfig): HarnessAdapter[] {
  const configured = new Set(config.harness ?? []);
  return HARNESS_ADAPTERS.filter((harness) => configured.has(harness.id));
}

async function reportSkillMetadata(
  name: string,
  directory: string,
  harnesses: readonly HarnessAdapter[],
  ctx: CommandContext,
): Promise<void> {
  const findings = await validateSkillForHarnesses(name, directory, harnesses);
  for (const finding of findings) {
    ctx.logger.warn({
      message: `${finding.harnessId}: skill "${finding.skillName}" ${finding.message}`,
      status: finding.file,
    });
  }
}

async function findMaterializedSkill(
  name: string,
  ctx: CommandContext,
): Promise<string | undefined> {
  const config = await readConfigOrDefault(ctx.configPath);
  const localRoot = config.skills?.dir ?? DEFAULT_LOCAL_SKILLS_DIR;
  const localDirectory = path.isAbsolute(localRoot)
    ? path.join(localRoot, name)
    : path.resolve(ctx.projectRoot, localRoot, name);
  try {
    await fs.access(path.join(localDirectory, "SKILL.md"));
    return localDirectory;
  } catch {
    for (const harness of HARNESS_ADAPTERS) {
      const skillsDir = harness.paths?.skillsDir;
      if (!skillsDir) continue;
      const directory = path.join(ctx.projectRoot, skillsDir, name);
      try {
        await fs.access(path.join(directory, "SKILL.md"));
        return await fs.realpath(directory);
      } catch {
        continue;
      }
    }
    return undefined;
  }
}

function flagValues(value: unknown): string[] {
  if (typeof value === "string")
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return [];
}

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
): RepositoryRequest {
  if (source.kind === "git") {
    const request: RepositoryRequest = {
      source: source.remoteUrl ?? `${source.provider}:${source.owner}/${source.repo}`,
      glob: skillPath,
    };
    if (source.ref && /^[a-f0-9]{7,64}$/i.test(source.ref)) request.commit = source.ref;
    else if (source.ref) request.branch = source.ref;
    return request;
  }
  return {
    source: parseSource(`file:${path.join(localRoot, skillPath)}`, { projectRoot }).canonical,
    glob: ".",
  };
}

function requestFromComposite(value: string, projectRoot: string): RepositoryRequest {
  const parsed = parseCompositeSkillRef(value, { projectRoot });
  if (parsed.source.kind === "local") return { source: parsed.source.canonical, glob: "." };
  const request: RepositoryRequest = {
    source: `${parsed.source.provider}:${parsed.source.owner}/${parsed.source.repo}`,
    glob: parsed.subPath,
  };
  const ref = parsed.source.ref;
  if (ref && /^[a-f0-9]{7,64}$/i.test(ref)) request.commit = ref;
  else if (ref) request.branch = ref;
  return request;
}

/** Run a single read-only step over every declared skill and report failures. */
async function diagnose(
  which: "fetch" | "version" | "integrity",
  config: AgnosConfig,
  ctx: CommandContext,
): Promise<void> {
  const sources = config.skills?.sources ?? {};
  const count = Object.keys(sources).length;
  if (count === 0) {
    ctx.logger.info("no skills declared");
    return;
  }
  const { steps } = await createSkillSteps(config, ctx, {
    verifyMaterialized: which === "integrity",
  });
  const bad: string[] = [];
  await ctx.logger.info({
    message: `Checking ${count} skill${count === 1 ? "" : "s"}…`,
    waitFor: (async () => {
      for (const [name, request] of Object.entries(sources)) {
        const f = await steps.fetch(name, request);
        if (!f.ok || !f.src) {
          if (which === "fetch") bad.push(name);
          continue;
        }
        if (which === "version" && !(await steps.version(name, f.src))) bad.push(name);
        else if (which === "integrity" && !(await steps.integrity(name, f.src))) bad.push(name);
      }
    })(),
  });
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
      {
        name: "glob",
        type: "string",
        description: "Repository-relative glob for skill directories or SKILL.md markers",
      },
      {
        name: "branch",
        type: "string",
        description: "Branch to follow for every Git source in this command",
      },
      {
        name: "commit",
        type: "string",
        description: "Commit to pin for every Git source in this command",
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
      const discoveryGlob = typeof ctx.flags.glob === "string" ? ctx.flags.glob : undefined;
      const selectedRef =
        typeof ctx.flags.commit === "string"
          ? ctx.flags.commit
          : typeof ctx.flags.branch === "string"
            ? ctx.flags.branch
            : undefined;
      if (ctx.dryRun) {
        for (const address of addresses) {
          ctx.logger.info(`would: discover skills from ${address}`);
        }
        return;
      }

      const temporaryConsumers: { trackingId: string; name: string }[] = [];
      const acquiredConsumers: { trackingId: string; name: string }[] = [];
      const releasedConsumers: { trackingId: string; name: string }[] = [];
      let declarationSaved = false;
      try {
        // Discover from shared tracker checkouts so discovery and installation use
        // the same normalized repository selection and Git implementation.
        const label = addresses.length === 1 ? addresses[0] : `${addresses.length} sources`;
        const fetchedRepos = await ctx.logger.info({
          message: `Loading skills from ${label}…`,
          waitFor: Promise.all(
            addresses.map(async (address, order) => {
              let parsedSource = repoSource(
                providerFor(provider, address),
                address,
                ctx.projectRoot,
              );
              if (parsedSource.kind === "git" && selectedRef) {
                parsedSource = {
                  ...parsedSource,
                  ref: selectedRef,
                  canonical: `${parsedSource.canonical.split("#", 1)[0]}#${selectedRef}`,
                };
              }
              let localRoot: string;
              let ref: string | undefined;
              let trackingId: string | undefined;
              let consumerName: string | undefined;
              if (parsedSource.kind === "git") {
                const request: RepositoryRequest = {
                  source:
                    parsedSource.remoteUrl ??
                    `${parsedSource.provider}:${parsedSource.owner}/${parsedSource.repo}`,
                  ...(parsedSource.ref && /^[a-f0-9]{7,64}$/i.test(parsedSource.ref)
                    ? { commit: parsedSource.ref }
                    : parsedSource.ref
                      ? { branch: parsedSource.ref }
                      : {}),
                  glob: ".",
                };
                consumerName = `discovery-${randomUUID()}`;
                const tracked = await ctx.repositoryTracker.add(request, {
                  projectId: path.resolve(ctx.configPath),
                  domain: "skills-discovery",
                  name: consumerName,
                });
                temporaryConsumers.push({ trackingId: tracked.trackingId, name: consumerName });
                localRoot = tracked.checkoutPath;
                ref = tracked.branch;
                trackingId = tracked.trackingId;
              } else {
                localRoot = parsedSource.absolutePath;
              }
              const skills = await findSkillsInRepo(localRoot, discoveryGlob);
              const repo: Repo = {
                address,
                source: parsedSource,
                localRoot,
                ...(ref ? { ref } : {}),
                order,
                ...(trackingId ? { trackingId } : {}),
                ...(consumerName ? { consumerName } : {}),
              };
              return { repo, skills };
            }),
          ),
        });

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
          const isInstalled = (c: Candidate): boolean => {
            const declared = existing[c.name];
            return Boolean(
              declared &&
              skillRequestKey(declared) ===
                skillRequestKey(
                  compositeFor(c.repo.source, c.repo.localRoot, c.skill.path, ctx.projectRoot),
                ),
            );
          };
          const anyInstalled = candidates.some(isInstalled);
          const message = anyInstalled
            ? "Select skills to add (already-installed skills are preselected):"
            : "Select skills to add:";
          const choices = candidates.map((c, i) => {
            const description = capDescription(c.skill.description);
            return {
              name: choiceLabel(c),
              value: String(i),
              group: c.name, // selecting one auto-deselects same-named candidates
              checked: isInstalled(c),
              ...(description ? { description } : {}),
            };
          });
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
          chosen = picked.map((i) => {
            const candidate = candidates[Number(i)];
            if (!candidate) throw new Error(`invalid skill selection: ${i}`);
            return candidate;
          });
        }

        // Expand each pick into a concrete per-skill composite ref. Storage shape
        // is one entry per skill name — an already-declared name is overwritten.
        const sources: Record<string, RepositoryRequest> = { ...existing };
        const added: string[] = [];
        for (const { repo, skill, name } of chosen) {
          const named = skillNameSchema.safeParse(name);
          if (!named.success) {
            throw new Error(
              `"${name}" (from ${skill.path} in ${repo.address}) is not a valid skill name; ` +
                `the skill directory name must be alphanumeric/dash`,
            );
          }
          const request = compositeFor(repo.source, repo.localRoot, skill.path, ctx.projectRoot);
          await reportSkillMetadata(
            name,
            path.join(repo.localRoot, skill.path),
            configuredHarnesses(config),
            ctx,
          );
          sources[named.data] = request;
          added.push(`${named.data} → ${request.source} (${request.glob ?? "."})`);
        }

        for (const { repo, skill, name } of chosen) {
          if (repo.source.kind !== "git") continue;
          const request = compositeFor(repo.source, repo.localRoot, skill.path, ctx.projectRoot);
          const consumer = {
            projectId: path.resolve(ctx.configPath),
            domain: "skills",
            name,
          };
          const previous = await ctx.repositoryTracker.listRegistrations(consumer);
          const info = await ctx.repositoryTracker.add(request, consumer);
          if (!previous.some((registration) => registration.trackingId === info.trackingId))
            acquiredConsumers.push({ trackingId: info.trackingId, name });
          for (const registration of previous)
            if (registration.trackingId !== info.trackingId)
              releasedConsumers.push({ trackingId: registration.trackingId, name });
        }
        await writeChange(ctx, `added ${added.length} skill(s): ${added.join(", ")}`, {
          ...config,
          skills: { ...config.skills, sources },
        });
        declarationSaved = true;
        for (const consumer of releasedConsumers) {
          await ctx.repositoryTracker.remove(consumer.trackingId, {
            projectId: path.resolve(ctx.configPath),
            domain: "skills",
            name: consumer.name,
          });
        }
      } finally {
        if (!declarationSaved) {
          for (const consumer of acquiredConsumers) {
            await ctx.repositoryTracker.remove(consumer.trackingId, {
              projectId: path.resolve(ctx.configPath),
              domain: "skills",
              name: consumer.name,
            });
          }
        }
        for (const consumer of temporaryConsumers) {
          await ctx.repositoryTracker.remove(consumer.trackingId, {
            projectId: path.resolve(ctx.configPath),
            domain: "skills-discovery",
            name: consumer.name,
          });
        }
      }
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
        const localSkillsDir = path.resolve(
          ctx.projectRoot,
          config.skills?.dir ?? DEFAULT_LOCAL_SKILLS_DIR,
        );
        const choices = await Promise.all(
          declared.map(async (n) => {
            const { description } = await readSkillMeta(path.join(localSkillsDir, n, "SKILL.md"));
            const desc = capDescription(description);
            const source = all[n];
            if (!source) throw new Error(`skill "${n}" is not declared`);
            return {
              name: `${n} ${colors.dim(`${source.source} (${source.glob ?? "."})`)}`,
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
      const next: AgnosConfig = {
        ...config,
        skills: { ...config.skills, sources },
      };
      await writeChange(ctx, `removed ${targets.length} skill(s): ${targets.join(", ")}`, next);
      if (!ctx.dryRun) {
        const lock = await readLock(ctx.projectRoot);
        let nextLock = lock;
        for (const name of targets) {
          const request = all[name];
          if (request) nextLock = removeSkill(nextLock, skillRequestKey(request));
        }
        if (nextLock !== lock) await writeLock(ctx.projectRoot, nextLock);
        for (const name of targets) {
          const consumer = { projectId: path.resolve(ctx.configPath), domain: "skills", name };
          for (const registration of await ctx.repositoryTracker.listRegistrations(consumer)) {
            await ctx.repositoryTracker.remove(registration.trackingId, consumer);
          }
          const localRoot = config.skills?.dir ?? DEFAULT_LOCAL_SKILLS_DIR;
          const localTarget = path.isAbsolute(localRoot)
            ? path.join(localRoot, name)
            : path.resolve(ctx.projectRoot, localRoot, name);
          const localMarker = path.join(localTarget, "SKILL.md");
          const hasLocal = await fs
            .access(localMarker)
            .then(() => true)
            .catch(() => false);
          for (const adapter of HARNESS_ADAPTERS) {
            const skillsDir = adapter.paths?.skillsDir;
            if (!skillsDir) continue;
            const link = path.resolve(ctx.projectRoot, skillsDir, name);
            const existing = await fs.lstat(link).catch(() => null);
            if (hasLocal) {
              await ensureLink(localTarget, link, ctx.linker);
            } else if (existing?.isSymbolicLink()) {
              const target = await fs.realpath(link).catch(() => "");
              const global = path.resolve(ctx.storeDir);
              if (target === global || target.startsWith(`${global}${path.sep}`))
                await fs.unlink(link);
            }
          }
        }
      }
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
      ctx.logger.success({
        message: "Installing skills 100%",
        status: `total ${res.progress.total} | reused ${res.progress.reused} | fetched ${res.progress.fetched}`,
      });
    },
  },
  check: {
    name: "check",
    description: "Check installed skill metadata against configured harnesses",
    flags: [
      { name: "skills", type: "string", description: "comma-separated skill names" },
      {
        name: "harness",
        type: "string",
        description: "harness id (defaults to configured harnesses)",
      },
    ],
    async run(ctx) {
      const config = await readConfigOrDefault(ctx.configPath);
      const requestedSkills = flagValues(ctx.flags["skills"]);
      const harnessRef = ctx.flags["harness"];
      const harnessIds = typeof harnessRef === "string" ? [harnessRef] : (config.harness ?? []);
      const harnesses = harnessIds.map((id) => {
        const harness = HARNESS_ADAPTERS.find((candidate) => candidate.id === id);
        if (!harness) throw new Error(`unknown harness "${id}"`);
        return harness;
      });
      const localRoot = config.skills?.dir ?? DEFAULT_LOCAL_SKILLS_DIR;
      const localDirectory = path.isAbsolute(localRoot)
        ? localRoot
        : path.resolve(ctx.projectRoot, localRoot);
      const localNames = await fs.readdir(localDirectory, { withFileTypes: true }).catch(() => []);
      const availableNames = new Set([
        ...Object.keys(config.skills?.sources ?? {}),
        ...localNames.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
      ]);
      const names = requestedSkills.length > 0 ? requestedSkills : [...availableNames].sort();
      const missing = names.filter((name) => !availableNames.has(name));
      if (missing.length > 0) throw new Error(`skill(s) not found: ${missing.join(", ")}`);
      if (harnesses.length === 0) {
        ctx.logger.info("no harnesses configured; pass --harness to check a target");
        return;
      }
      for (const name of names) {
        const directory = await findMaterializedSkill(name, ctx);
        if (!directory) {
          ctx.logger.warn(`skill "${name}" is not installed; run agnos skills install`);
          continue;
        }
        await reportSkillMetadata(name, directory, harnesses, ctx);
      }
      if (names.length === 0) ctx.logger.info("no skills available to check");
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
      const declared = Object.keys(config.skills?.sources ?? {});
      const n = ctx.args.length > 0 ? ctx.args.length : declared.length;
      const updated = await ctx.logger.info({
        message: `Updating ${n} skill${n === 1 ? "" : "s"}…`,
        waitFor: updateSkills(ctx.args, config, ctx),
      });
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
      const discovered: Record<string, RepositoryRequest> = {};
      for (const [name, ref] of Object.entries((map ?? {}) as Record<string, unknown>)) {
        if (typeof ref !== "string") continue;
        if (!skillNameSchema.safeParse(name).success) {
          ctx.logger.warn(`skipping invalid skill "${name}"`);
          continue;
        }
        try {
          discovered[name] = requestFromComposite(ref, ctx.projectRoot);
        } catch {
          ctx.logger.warn(`skipping invalid skill "${name}"`);
        }
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
 * bytes. `run` acquires declared sources through the global tracker and updates
 * lock observations. The harness domain links selected skill directories into
 * each agent's native skills folder. The
 * `fetch`/`version`/`integrity`/`install`/`update`/`migrate` subcommands expose
 * the same engine; data layer in pipeline.ts / migrate.ts / steps.ts.
 */
export const skillsDomain: Domain = {
  id: "skills",
  description: "Track external skills and expose local skills to configured harnesses",
  kind: "writer",
  priority: 10,
  color: "magenta",
  commands,
  initSteps: [
    {
      id: "directory",
      type: "text",
      message: "Directory for manually authored skills (relative to project root):",
      default: DEFAULT_LOCAL_SKILLS_DIR,
      async callback(value, ctx) {
        const skillsDirectory = value.trim() || DEFAULT_LOCAL_SKILLS_DIR;
        const config = await readConfigOrDefault(ctx.configPath);
        const skills = { ...(config.skills ?? {}) };
        if (skillsDirectory === DEFAULT_LOCAL_SKILLS_DIR) delete skills.dir;
        else skills.dir = skillsDirectory;
        const next: AgnosConfig = { ...config, skills };
        if (ctx.dryRun) {
          ctx.logger.info(`would: set skills.dir = ${skillsDirectory}`);
          return;
        }
        await writeConfig(ctx.configPath, next);
        const localSkillsDir = path.isAbsolute(skillsDirectory)
          ? skillsDirectory
          : path.resolve(ctx.projectRoot, skillsDirectory);
        await fs.mkdir(localSkillsDir, { recursive: true });
      },
    },
  ],
  async run(opts, ctx) {
    const config = await readConfigOrDefault(ctx.configPath);
    const sources = config.skills?.sources ?? {};
    // No skill sources declared → nothing to fetch/verify.
    const count = Object.keys(sources).length;
    if (count === 0) {
      return undefined;
    }
    // Run the offline prep pipeline (fetch → integrity → install). Failures are
    // bucketed and reported as "Skills need to be updated: …" without throwing,
    // so the overall run continues (§13.1).
    const handle = await createSkillSteps(config, ctx);
    const result = await runSkillPipeline(sources, handle.steps, ctx.logger);
    await handle.flush();
    ctx.logger.success({
      message: "Installing skills 100%",
      status: `total ${result.progress.total} | reused ${result.progress.reused} | fetched ${result.progress.fetched}`,
    });
    return undefined;
  },
};

export default skillsDomain;
