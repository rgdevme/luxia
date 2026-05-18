import fs from "node:fs/promises";
import path from "node:path";
import { checkbox } from "@inquirer/prompts";
import picomatch from "picomatch";
import { z } from "zod";
import { buildPaths } from "../paths.js";
import { readConfig, writeConfig } from "../config.js";
import { loadPlugins } from "../plugin-loader.js";
import { buildResolveContext } from "../context.js";
import { resolveSkill } from "../orchestrator.js";
import {
  activeAgents,
  dispatchSkillAdded,
  dispatchSkillRemoved,
  dispatchSkillUpdated,
} from "../events.js";
import {
  parseSource,
  isProvider,
  SUPPORTED_PROVIDERS,
  type Provider,
  type ParsedSource,
} from "../source.js";
import { resolveGitCommit } from "../commit-resolver.js";
import { findSkillsInRepo, type DiscoveredSkill } from "../skill-discovery.js";
import { getSkill, readLock, removeSkill, upsertSkill, writeLock } from "../lock.js";
import { hashSkillDir } from "../skill-hash.js";
import type {
  AgnosConfig,
  Logger,
  ResolveContext,
  ResolvedSkill,
  SkillLockEntry,
} from "../types/public.js";

const SKILL_MARKER = "SKILL.md";

export interface SkillOptions {
  cwd: string;
  sub: string | undefined;
  args: string[];
  noInstall: boolean;
  copyOnNoSymlink: boolean;
  dryRun?: boolean;
  logger: Logger;
  /** -p / --provider for `add` when source is bare `owner/repo`. */
  provider?: string;
  /** -s / --skills selector list (comma separated globs) for `add`. */
  skills?: string;
  /** --ref for `update`, picks an explicit commit/branch/tag. */
  ref?: string;
  /** --name override for `add`. */
  name?: string;
}

export async function runSkill(opts: SkillOptions): Promise<void> {
  const paths = buildPaths(opts.cwd);
  const config = await readConfig(paths.configPath);
  const ctx = await buildResolveContext({
    projectRoot: opts.cwd,
    logger: opts.logger,
    dryRun: opts.dryRun ?? false,
    config,
  });
  const registry = await loadPlugins({ projectRoot: opts.cwd, logger: opts.logger });

  const domain = registry.domains.get("skills");
  if (!domain) {
    throw new Error("no skills domain plugin installed. Run `pnpm add @luxia/domain-skills`.");
  }

  const agents = activeAgents(config, registry, ctx);

  switch (opts.sub) {
    case "add":
      await runAdd(opts, ctx, config, agents);
      return;
    case "remove":
      await runRemove(opts, ctx, config, agents);
      return;
    case "update":
      await runUpdate(opts, ctx, config, agents);
      return;
    case "migrate":
      await runMigrate(opts, ctx, config, agents);
      return;
    case "list":
    case undefined: {
      if (!domain.plugin.list) throw new Error("skills domain has no list()");
      const items = await domain.plugin.list(ctx);
      for (const item of items) opts.logger.info(JSON.stringify(item));
      return;
    }
    default:
      throw new Error(`unknown skill subcommand: ${opts.sub}`);
  }
}

// ---------- add ----------

interface SelectedSkill {
  /** Final local name after disambiguation. */
  name: string;
  /** Composite source ref written into agnos.json#skills[name]. */
  composite: string;
  /** Absolute source path in the fetched tree, used for materialization. */
  fetchedAbsPath: string;
  /** For logging — what the discovered default name was, if any. */
  discoveredDefaultName?: string;
}

async function runAdd(
  opts: SkillOptions,
  ctx: ResolveContext,
  config: AgnosConfig,
  agents: ReturnType<typeof activeAgents>,
): Promise<void> {
  const sourceArg = opts.args[0];
  if (!sourceArg) {
    throw new Error("usage: agnos skill add <source> [-p <provider>] [-s <list>] [--name <name>]");
  }

  const providerFlag = opts.provider;
  if (providerFlag && !isProvider(providerFlag)) {
    throw new Error(
      `unknown provider "${providerFlag}". Supported: ${SUPPORTED_PROVIDERS.join(", ")}.`,
    );
  }
  const parsed = parseSource(sourceArg, {
    projectRoot: ctx.projectRoot,
    defaultProvider: providerFlag as Provider | undefined,
  });

  // Whether the source already names a specific skill (git subPath, or a local
  // path pointing at a directory containing SKILL.md).
  const directSkill = await asDirectSkillRef(parsed);

  if (directSkill) {
    if (opts.skills) {
      throw new Error(
        `--skills cannot be combined with a sub-path source. The path "${directSkill.subPathOrDir}"` +
          ` already selects a specific skill.`,
      );
    }
    await addOne(opts, ctx, config, agents, parsed, directSkill);
    return;
  }

  // Repo-only (or local repo) — discovery + selection flow.
  if (parsed.kind === "local") {
    // Sanity: a local source without SKILL.md at its root falls through to
    // discovery against its tree. The directory must exist.
    if (!(await dirExists(parsed.absolutePath))) {
      throw new Error(`local source "${parsed.canonical}" does not exist`);
    }
  }

  const fetched = await ctx.fetcher.fetch(parsed);
  const discovered = await findSkillsInRepo(fetched.path);
  if (discovered.length === 0) {
    throw new Error(
      `no installable skills found in ${parsed.canonical} — no SKILL.md anywhere in the source` +
        ` (excluding standard build / VCS dirs)`,
    );
  }

  const picked = await pickDiscovered(discovered, opts.skills, opts.logger);
  if (picked.length === 0) {
    opts.logger.info("no skills selected — nothing to do");
    return;
  }
  if (opts.name && picked.length !== 1) {
    throw new Error(
      `--name can only be used when exactly one skill is selected (got ${picked.length}).` +
        ` Tighten --skills, or omit --name to use the default basenames.`,
    );
  }

  const selected = disambiguateFromDiscovery(picked, parsed, fetched.path, opts.name, config);
  await commitSelection(opts, ctx, config, agents, selected);
}

/** Single-skill direct add (sub-path or local-skill-directory source). */
async function addOne(
  opts: SkillOptions,
  ctx: ResolveContext,
  config: AgnosConfig,
  agents: ReturnType<typeof activeAgents>,
  parsed: ParsedSource,
  direct: DirectSkillRef,
): Promise<void> {
  const fetched = await ctx.fetcher.fetch(parsed);
  const skillSrc =
    direct.kind === "git" ? path.join(fetched.path, direct.subPathOrDir) : fetched.path;
  if (!(await isSkillDir(skillSrc))) {
    throw new Error(
      `no SKILL.md found at ${parsed.canonical}` +
        (direct.kind === "git" ? ` (path "${direct.subPathOrDir}" inside the repo)` : ""),
    );
  }
  const composite = parsed.canonical;
  const baseName =
    direct.kind === "git" ? path.basename(direct.subPathOrDir) : path.basename(skillSrc);
  const finalName = chooseUniqueName(opts.name ?? baseName, composite, config);
  const sel: SelectedSkill = {
    name: finalName,
    composite,
    fetchedAbsPath: skillSrc,
    discoveredDefaultName: baseName,
  };
  await commitSelection(opts, ctx, config, agents, [sel]);
}

interface DirectSkillRef {
  kind: "git" | "local";
  /** For git: the in-repo path. For local: the absolute on-disk path. */
  subPathOrDir: string;
}

/**
 * Returns a DirectSkillRef when the parsed source already names a specific
 * skill (git with subPath, or local dir containing SKILL.md). Otherwise null.
 * For local, we have to filesystem-probe — `file:./repo` vs `file:./repo/skills/pdf`
 * both look the same to the parser, the difference is whether SKILL.md is there.
 */
async function asDirectSkillRef(parsed: ParsedSource): Promise<DirectSkillRef | null> {
  if (parsed.kind === "git") {
    if (parsed.subPath) return { kind: "git", subPathOrDir: parsed.subPath };
    return null;
  }
  // Local: probe for SKILL.md at the resolved path.
  if (await isSkillDir(parsed.absolutePath)) {
    return { kind: "local", subPathOrDir: parsed.absolutePath };
  }
  return null;
}

async function commitSelection(
  opts: SkillOptions,
  ctx: ResolveContext,
  config: AgnosConfig,
  agents: ReturnType<typeof activeAgents>,
  selected: SelectedSkill[],
): Promise<void> {
  if (ctx.dryRun) {
    const summary = selected.map((s) => `${s.name} ← ${s.composite}`).join(", ");
    opts.logger.info(`would: add ${selected.length} skill(s): ${summary}`);
    return;
  }

  // Materialize, hash, write agnos.json + agnos.lock.json.
  const skillsDir = buildPaths(ctx.projectRoot, config).skillsDir;
  await fs.mkdir(skillsDir, { recursive: true });

  let lock = await readLock(ctx.projectRoot);
  const skills = { ...(config.skills ?? {}) };
  const resolvedItems: ResolvedSkill[] = [];

  for (const sel of selected) {
    const targetDir = path.join(skillsDir, sel.name);
    await fs.rm(targetDir, { recursive: true, force: true });
    await fs.cp(sel.fetchedAbsPath, targetDir, { recursive: true, force: true });

    const hash = await hashSkillDir(sel.fetchedAbsPath);
    skills[sel.name] = sel.composite;
    lock = upsertSkill(lock, sel.composite, {
      computedHash: hash,
      resolvedAt: new Date().toISOString(),
    });
    resolvedItems.push({ name: sel.name, absolutePath: targetDir });

    if (sel.discoveredDefaultName && sel.name !== sel.discoveredDefaultName) {
      opts.logger.info(`renamed ${sel.discoveredDefaultName} → ${sel.name} to avoid collision`);
    }
  }

  config.skills = skills;
  await writeConfig(ctx.configPath, config);
  await writeLock(ctx.projectRoot, lock);

  opts.logger.success(
    `added ${selected.length} skill(s): ${selected.map((s) => s.name).join(", ")}`,
  );

  if (opts.noInstall) return;
  for (const item of resolvedItems) {
    await dispatchSkillAdded(item, agents, config, ctx);
  }
}

// ---------- update ----------

async function runUpdate(
  opts: SkillOptions,
  ctx: ResolveContext,
  config: AgnosConfig,
  agents: ReturnType<typeof activeAgents>,
): Promise<void> {
  const name = opts.args[0];
  if (!name) throw new Error("usage: agnos skill update <name> [--ref <ref>]");

  const composite = (config.skills ?? {})[name];
  if (!composite) throw new Error(`skill "${name}" is not declared in agnos.json`);

  const parsed = parseSource(composite, { projectRoot: ctx.projectRoot });

  if (ctx.dryRun) {
    opts.logger.info(`would: update ${name} (${composite})${opts.ref ? ` @${opts.ref}` : ""}`);
    return;
  }

  // For git: --ref resolves to a specific commit so giget pins; otherwise default branch.
  let ref: string | undefined;
  if (parsed.kind === "git" && opts.ref) {
    const resolution = await resolveGitCommit(parsed, opts.ref);
    ref = resolution.commit ?? opts.ref;
  }

  const fetched = await ctx.fetcher.fetch(parsed, {
    ...(ref ? { ref } : {}),
    noCache: true,
  });

  const skillSrc =
    parsed.kind === "git" && parsed.subPath
      ? path.join(fetched.path, parsed.subPath)
      : fetched.path;

  if (!(await isSkillDir(skillSrc))) {
    throw new Error(
      `cannot update "${name}": SKILL.md not found at ${composite}` +
        ` — the path may have moved or been removed upstream.` +
        ` Re-bind with \`agnos skill remove ${name}\` then \`agnos skill add ${parsed.canonical}\`.`,
    );
  }

  const hash = await hashSkillDir(skillSrc);
  const skillsDir = buildPaths(ctx.projectRoot, config).skillsDir;
  const dst = path.join(skillsDir, name);
  await fs.rm(dst, { recursive: true, force: true });
  await fs.cp(skillSrc, dst, { recursive: true, force: true });

  const lock = await readLock(ctx.projectRoot);
  const next: SkillLockEntry = { computedHash: hash, resolvedAt: new Date().toISOString() };
  await writeLock(ctx.projectRoot, upsertSkill(lock, composite, next));

  opts.logger.success(`updated ${name} (${composite}) → ${hash.slice(0, 12)}…`);

  if (opts.noInstall) return;
  await dispatchSkillUpdated({ name, absolutePath: dst }, agents, config, ctx);
}

// ---------- migrate ----------

const MIGRATE_DEFAULT_FILE = "skills-lock.json";

const externalLockEntrySchema = z.object({
  source: z.string().min(1),
  sourceType: z.string().min(1),
  computedHash: z.string().optional(),
});

const externalLockSchema = z.object({
  version: z.literal(1),
  skills: z.record(z.string().min(1), externalLockEntrySchema),
});

export async function runMigrate(
  opts: SkillOptions,
  ctx: ResolveContext,
  config: AgnosConfig,
  agents: ReturnType<typeof activeAgents>,
): Promise<void> {
  const inputPath = path.resolve(ctx.projectRoot, opts.args[0] ?? MIGRATE_DEFAULT_FILE);

  let raw: string;
  try {
    raw = await fs.readFile(inputPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `skills lock file not found at ${inputPath}. ` +
          `Pass an explicit path: \`agnos skill migrate <path>\`.`,
      );
    }
    throw err;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${inputPath} is not valid JSON: ${(err as Error).message}`);
  }

  const validated = externalLockSchema.safeParse(parsedJson);
  if (!validated.success) {
    throw new Error(`${inputPath} schema validation failed:\n${validated.error.message}`);
  }

  const entries = Object.entries(validated.data.skills);
  if (entries.length === 0) {
    opts.logger.info("nothing to migrate; agnos.json unchanged");
    return;
  }

  // Group by repo so each is fetched once.
  interface GroupEntry {
    name: string;
    sourceType: string;
    source: string;
  }
  const groups = new Map<string, GroupEntry[]>();
  for (const [name, entry] of entries) {
    if (!isProvider(entry.sourceType)) {
      throw new Error(
        `${inputPath}: unsupported sourceType "${entry.sourceType}" for "${name}". ` +
          `Supported: ${SUPPORTED_PROVIDERS.join(", ")}.`,
      );
    }
    const key = `${entry.sourceType}:${entry.source}`;
    const list = groups.get(key) ?? [];
    list.push({ name, sourceType: entry.sourceType, source: entry.source });
    groups.set(key, list);
  }

  const selected: SelectedSkill[] = [];
  const skipped: { name: string; reason: string }[] = [];
  const takenNames = new Set<string>(Object.keys(config.skills ?? {}));

  for (const [repoKey, items] of groups) {
    const parsed = parseSource(repoKey, { projectRoot: ctx.projectRoot });
    if (parsed.kind !== "git") {
      // Defensive — schema requires git-style sourceType, but parseSource may
      // produce a local source if `source` somehow looks like a path.
      for (const it of items) {
        skipped.push({ name: it.name, reason: `non-git source ${repoKey}` });
      }
      continue;
    }

    if (ctx.dryRun) {
      // Dry-run: don't fetch; we can't know in-repo paths without a fetch, so
      // log the intent at the repo level.
      for (const it of items) {
        opts.logger.info(
          `would: migrate ${it.name} from ${repoKey} (in-repo path discovered at run-time)`,
        );
      }
      continue;
    }

    let fetched: { path: string };
    try {
      fetched = await ctx.fetcher.fetch(parsed);
    } catch (err) {
      for (const it of items) {
        skipped.push({ name: it.name, reason: `fetch failed: ${(err as Error).message}` });
      }
      continue;
    }

    const discovered = await findSkillsInRepo(fetched.path);
    for (const it of items) {
      const matches = discovered.filter((d) => d.defaultName === it.name);
      if (matches.length === 0) {
        opts.logger.warn(
          `skills: cannot locate "${it.name}" in ${repoKey}; skipping ` +
            `(use \`agnos skill add\` to add it manually)`,
        );
        skipped.push({ name: it.name, reason: "no matching SKILL.md" });
        continue;
      }
      const pick = matches.reduce((a, b) => (a.path.length <= b.path.length ? a : b));
      if (matches.length > 1) {
        opts.logger.debug(
          `skills: multiple matches for "${it.name}" in ${repoKey}; picked ${pick.path}`,
        );
      }

      const composite = `${parsed.provider}:${parsed.owner}/${parsed.repo}/${pick.path}`;
      const existingComposite = (config.skills ?? {})[it.name];
      let finalName = it.name;
      if (existingComposite && existingComposite !== composite) {
        let i = 2;
        while (takenNames.has(finalName) && (config.skills ?? {})[finalName] !== composite) {
          finalName = `${it.name}-${i++}`;
        }
      }
      takenNames.add(finalName);
      selected.push({
        name: finalName,
        composite,
        fetchedAbsPath: path.join(fetched.path, pick.path),
        discoveredDefaultName: it.name,
      });
    }
  }

  if (ctx.dryRun) {
    opts.logger.info(
      `would: migrate ${entries.length} skill(s) from ${path.relative(ctx.projectRoot, inputPath) || inputPath}`,
    );
    return;
  }

  if (selected.length === 0) {
    opts.logger.warn(`migrated 0/${entries.length} skills; nothing written`);
    return;
  }

  // Materialize + persist (mirrors commitSelection).
  const skillsDir = buildPaths(ctx.projectRoot, config).skillsDir;
  await fs.mkdir(skillsDir, { recursive: true });

  let lock = await readLock(ctx.projectRoot);
  const skills = { ...(config.skills ?? {}) };
  const resolvedItems: ResolvedSkill[] = [];

  for (const sel of selected) {
    const targetDir = path.join(skillsDir, sel.name);
    await fs.rm(targetDir, { recursive: true, force: true });
    await fs.cp(sel.fetchedAbsPath, targetDir, { recursive: true, force: true });

    const hash = await hashSkillDir(sel.fetchedAbsPath);
    skills[sel.name] = sel.composite;
    lock = upsertSkill(lock, sel.composite, {
      computedHash: hash,
      resolvedAt: new Date().toISOString(),
    });
    resolvedItems.push({ name: sel.name, absolutePath: targetDir });

    if (sel.discoveredDefaultName && sel.name !== sel.discoveredDefaultName) {
      opts.logger.info(`renamed ${sel.discoveredDefaultName} → ${sel.name} to avoid collision`);
    }
  }

  config.skills = skills;
  await writeConfig(ctx.configPath, config);
  await writeLock(ctx.projectRoot, lock);

  const tail = skipped.length > 0 ? ` (skipped: ${skipped.map((s) => s.name).join(", ")})` : "";
  opts.logger.success(
    `migrated ${selected.length}/${entries.length} skills from ${path.relative(ctx.projectRoot, inputPath) || inputPath}${tail}`,
  );

  if (opts.noInstall) return;
  for (const item of resolvedItems) {
    await dispatchSkillAdded(item, agents, config, ctx);
  }
}

// ---------- remove ----------

async function runRemove(
  opts: SkillOptions,
  ctx: ResolveContext,
  config: AgnosConfig,
  agents: ReturnType<typeof activeAgents>,
): Promise<void> {
  const name = opts.args[0];
  if (!name) throw new Error("usage: agnos skill remove <name>");

  const composite = (config.skills ?? {})[name];
  if (!composite) throw new Error(`skill "${name}" is not declared in agnos.json`);

  if (ctx.dryRun) {
    opts.logger.info(`would: remove skill ${name}`);
    return;
  }

  const skillsDir = buildPaths(ctx.projectRoot, config).skillsDir;
  await fs.rm(path.join(skillsDir, name), { recursive: true, force: true });

  const { [name]: _removed, ...nextSkills } = config.skills ?? {};
  void _removed;
  config.skills = nextSkills;
  await writeConfig(ctx.configPath, config);

  const lock = await readLock(ctx.projectRoot);
  // Drop the lock entry only if no remaining skill points at the same composite source.
  const stillUsed = Object.values(nextSkills).includes(composite);
  if (!stillUsed && getSkill(lock, composite)) {
    await writeLock(ctx.projectRoot, removeSkill(lock, composite));
  }

  opts.logger.success(`removed skill: ${name}`);
  if (opts.noInstall) return;
  await dispatchSkillRemoved(name, agents, config, ctx);
}

// ---------- helpers ----------

async function pickDiscovered(
  discovered: DiscoveredSkill[],
  selectorList: string | undefined,
  logger: Logger,
): Promise<DiscoveredSkill[]> {
  const selectors = (selectorList ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (selectors.length === 0) {
    const picked = await checkbox<string>({
      message: "Select skills to install:",
      choices: discovered.map((d) => ({
        name: d.title
          ? `${d.defaultName} — ${d.title}  (${d.path})`
          : `${d.defaultName}  (${d.path})`,
        value: d.path,
      })),
      pageSize: Math.min(20, Math.max(5, discovered.length)),
    });
    return discovered.filter((d) => picked.includes(d.path));
  }

  const misses: string[] = [];
  const seen = new Set<string>();
  const out: DiscoveredSkill[] = [];
  for (const sel of selectors) {
    const match = picomatch(sel);
    const hit = discovered.filter((d) => match(d.defaultName));
    if (hit.length === 0) {
      misses.push(sel);
      continue;
    }
    for (const d of hit) {
      if (seen.has(d.path)) continue;
      seen.add(d.path);
      out.push(d);
    }
  }
  if (misses.length > 0) {
    throw new Error(
      `skill selectors matched nothing: ${misses.join(", ")}. ` +
        `Available skills: ${discovered.map((d) => d.defaultName).join(", ")}.`,
    );
  }
  logger.debug(`selected ${out.length} skill(s) via -s ${selectors.join(",")}`);
  return out;
}

function disambiguateFromDiscovery(
  picked: DiscoveredSkill[],
  parsed: ParsedSource,
  fetchedRoot: string,
  nameOverride: string | undefined,
  config: AgnosConfig,
): SelectedSkill[] {
  const out: SelectedSkill[] = [];
  for (const d of picked) {
    const composite = compositeFor(parsed, d.path);
    const base = nameOverride ?? d.defaultName;
    const taken = new Set<string>([...Object.keys(config.skills ?? {}), ...out.map((o) => o.name)]);
    const existingComposite = (config.skills ?? {})[base];
    let name = base;
    if (existingComposite === composite) {
      // Re-adding the exact same skill — keep its name and overwrite.
    } else {
      let i = 2;
      while (taken.has(name)) name = `${base}-${i++}`;
    }
    out.push({
      name,
      composite,
      fetchedAbsPath: path.join(fetchedRoot, d.path),
      discoveredDefaultName: d.defaultName,
    });
  }
  return out;
}

/**
 * Build the composite ref to store in agnos.json#skills.
 *  - git: <provider>:<owner>/<repo>/<in-repo-path>
 *  - local: file:<canonical>/<rel-from-root> — but for local we anchor on the
 *    local source's canonical, which is already the directory path.
 */
function compositeFor(parsed: ParsedSource, inRepoPath: string): string {
  if (parsed.kind === "git") {
    return `${parsed.provider}:${parsed.owner}/${parsed.repo}/${inRepoPath}`;
  }
  // Local: re-anchor the canonical to point at the specific discovered skill.
  // parsed.canonical is "file:./local-repo"; we append the sub-path.
  const base = parsed.canonical;
  return base.endsWith("/") ? `${base}${inRepoPath}` : `${base}/${inRepoPath}`;
}

function chooseUniqueName(base: string, composite: string, config: AgnosConfig): string {
  const skills = config.skills ?? {};
  // Re-add of an identical composite is idempotent (overwrite same name).
  for (const [name, c] of Object.entries(skills)) {
    if (c === composite) return name;
  }
  const taken = new Set(Object.keys(skills));
  let name = base;
  let i = 2;
  while (taken.has(name)) name = `${base}-${i++}`;
  return name;
}

async function isSkillDir(p: string): Promise<boolean> {
  try {
    const s = await fs.stat(p);
    if (!s.isDirectory()) return false;
    await fs.access(path.join(p, SKILL_MARKER));
    return true;
  } catch {
    return false;
  }
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const s = await fs.stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

export async function resolveSkillByName(
  name: string,
  ctx: ResolveContext,
): Promise<ResolvedSkill> {
  return resolveSkill(name, ctx);
}
