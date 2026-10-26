import fs from "node:fs/promises";
import path from "node:path";
import { dump, load } from "js-yaml";
import type {
  AgnosConfig,
  CommandContext,
  CommandSpec,
  Domain,
  RepositoryConsumer,
  RepositoryRequest,
  ResolveContext,
} from "../../core/index.js";
import {
  DEFAULT_REFERENCES_DIR,
  ensureLink,
  readConfigOrDefault,
  writeConfig,
} from "../../core/index.js";

function buildConsumer(ctx: Pick<ResolveContext, "configPath">, name: string): RepositoryConsumer {
  return { projectId: path.resolve(ctx.configPath), domain: "references", name };
}

function defaultName(source: string): string {
  const withoutFragment = source.split("#", 1)[0] ?? source;
  const treeIndex = withoutFragment.indexOf("/tree/");
  const cloneSource = treeIndex < 0 ? withoutFragment : withoutFragment.slice(0, treeIndex);
  const segment = cloneSource.replace(/\/$/, "").split(/[/:]/).at(-1) ?? "reference";
  const name = segment
    .replace(/\.git$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return name || "reference";
}

function resolveDirectory(ctx: Pick<ResolveContext, "projectRoot">, config: AgnosConfig): string {
  const directory = config.references?.dir ?? DEFAULT_REFERENCES_DIR;
  if (path.isAbsolute(directory)) throw new Error("references.dir must be relative to the project");
  const resolved = path.resolve(ctx.projectRoot, directory);
  const relative = path.relative(ctx.projectRoot, resolved);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === "..") {
    throw new Error("references.dir must be a dedicated directory inside the project");
  }
  const normalized = relative.split(path.sep).join("/");
  if (
    normalized === ".git" ||
    normalized.startsWith(".git/") ||
    normalized === "node_modules" ||
    normalized.startsWith("node_modules/") ||
    normalized === ".agnos"
  ) {
    throw new Error(
      "references.dir cannot overlap .git, node_modules, or Agnos operational storage",
    );
  }
  return resolved;
}

async function validateRouteSafety(ctx: ResolveContext, config: AgnosConfig): Promise<string> {
  const route = resolveDirectory(ctx, config);
  const operationalRoutes = [
    config.skills?.dir ?? ".agnos/skills",
    config.rules?.dir ?? ".agnos/rules",
    config.docs?.dir ?? ".agnos/docs",
  ];
  for (const candidate of operationalRoutes) {
    if (candidate === "." || candidate === "./") continue;
    const output = path.resolve(ctx.projectRoot, candidate);
    const relative = path.relative(route, output);
    const reverse = path.relative(output, route);
    if (
      relative === "" ||
      (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)) ||
      (!reverse.startsWith(`..${path.sep}`) && reverse !== ".." && !path.isAbsolute(reverse))
    ) {
      throw new Error(`references.dir overlaps another project route: ${candidate}`);
    }
  }
  const projectReal = await fs.realpath(ctx.projectRoot);
  let existing = route;
  while (!(await fs.lstat(existing).catch(() => null))) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  const existingReal = await fs.realpath(existing);
  const relative = path.relative(projectReal, existingReal);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("references.dir resolves outside the project through a symbolic link");
  }
  return route;
}

async function installDeclared(config: AgnosConfig, ctx: ResolveContext): Promise<void> {
  const sources = config.references?.sources ?? {};
  const route = await validateRouteSafety(ctx, config);
  if (ctx.dryRun) {
    for (const name of Object.keys(sources)) ctx.logger.info(`would: install reference "${name}"`);
    return;
  }
  await fs.mkdir(route, { recursive: true });
  for (const [name, request] of Object.entries(sources)) {
    const consumer = buildConsumer(ctx, name);
    const previous = await ctx.repositoryTracker.listRegistrations(consumer);
    const info = await ctx.repositoryTracker.add(request, buildConsumer(ctx, name));
    try {
      if (info.entries.length !== 1 || info.entries[0]?.kind !== "directory") {
        throw new Error(`reference "${name}" selection must match exactly one directory`);
      }
      const destination = path.join(route, name);
      const existingLink = await fs.lstat(destination).catch(() => null);
      if (existingLink && !existingLink.isSymbolicLink()) {
        throw new Error(`reference destination is not managed by Agnos: ${destination}`);
      }
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await ensureLink(info.entries[0].absolutePath, destination, ctx.linker);
      for (const registration of previous) {
        if (registration.trackingId !== info.trackingId) {
          await ctx.repositoryTracker.remove(registration.trackingId, consumer);
        }
      }
      ctx.logger.success(`linked reference "${name}" at ${info.commit.slice(0, 12)}`);
    } catch (error) {
      if (!previous.some((registration) => registration.trackingId === info.trackingId)) {
        await ctx.repositoryTracker.remove(info.trackingId, buildConsumer(ctx, name));
      }
      throw error;
    }
  }
}

function resolveName(config: AgnosConfig, selector: string): string {
  const sources = config.references?.sources ?? {};
  if (selector in sources) return selector;
  const matches = Object.entries(sources).filter(([, request]) => request.source === selector);
  if (matches.length === 1) return matches[0]![0];
  if (matches.length > 1) {
    throw new Error(
      `reference "${selector}" is ambiguous; use a reference name: ${matches.map(([name]) => name).join(", ")}`,
    );
  }
  throw new Error(`reference "${selector}" is not declared`);
}

async function persistConfig(ctx: CommandContext, config: AgnosConfig): Promise<void> {
  if (ctx.dryRun) {
    ctx.logger.info("would: update agnos.json");
    return;
  }
  await writeConfig(ctx.configPath, config);
}

const commands: Record<string, CommandSpec> = {
  add: {
    name: "add",
    description: "Add and link a repository reference",
    args: [
      { name: "ref", required: true, description: "Git repository URL or supported shorthand" },
    ],
    flags: [
      {
        name: "branch",
        type: "string",
        description: "Branch to follow; defaults to the remote's default branch",
      },
      { name: "commit", type: "string", description: "Pin the reference to a commit" },
      {
        name: "glob",
        type: "string",
        description: "Repository-relative directory selection; defaults to .",
      },
      {
        name: "name",
        type: "string",
        description: "Project-local link name; defaults to the repository name",
      },
    ],
    async run(ctx) {
      const [source] = ctx.args;
      if (!source || ctx.args.length !== 1)
        throw new Error("references add expects one repository source");
      const config = await readConfigOrDefault(ctx.configPath);
      const name = typeof ctx.flags.name === "string" ? ctx.flags.name : defaultName(source);
      const sources = config.references?.sources ?? {};
      const request: RepositoryRequest = {
        source,
        ...(typeof ctx.flags.branch === "string" ? { branch: ctx.flags.branch } : {}),
        ...(typeof ctx.flags.commit === "string" ? { commit: ctx.flags.commit } : {}),
        ...(typeof ctx.flags.glob === "string" ? { glob: ctx.flags.glob } : {}),
      };
      const existing = sources[name];
      if (ctx.dryRun) {
        if (existing && existing.source === request.source) {
          ctx.logger.info(`reference "${name}" is already declared`);
          return;
        }
        ctx.logger.info(`would: add reference "${name}" from ${source}`);
        return;
      }
      if (!/^[a-z0-9][a-z0-9-]*$/i.test(name)) {
        throw new Error(`invalid reference link name: ${name}`);
      }
      const consumer = buildConsumer(ctx, name);
      const previous = await ctx.repositoryTracker.listRegistrations(consumer);
      const provisional = await ctx.repositoryTracker.add(request, buildConsumer(ctx, name));
      try {
        if (existing) {
          const same =
            existing.source === provisional.request.source &&
            existing.branch === provisional.request.branch &&
            existing.commit === provisional.request.commit &&
            (existing.glob ?? ".") === (provisional.request.glob ?? ".");
          if (!same)
            throw new Error(
              `reference name "${name}" already exists; choose another name with --name`,
            );
        }
        if (provisional.entries.length !== 1 || provisional.entries[0]?.kind !== "directory") {
          throw new Error(`reference "${name}" selection must match exactly one directory`);
        }
        const nextSources = { ...sources, [name]: existing ?? provisional.request };
        const next: AgnosConfig = {
          ...config,
          references: { ...config.references, sources: nextSources },
        };
        const destination = path.join(await validateRouteSafety(ctx, next), name);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        const oldLink = await fs.lstat(destination).catch(() => null);
        if (oldLink && !oldLink.isSymbolicLink()) {
          throw new Error(`reference destination is not managed by Agnos: ${destination}`);
        }
        await ensureLink(provisional.entries[0].absolutePath, destination, ctx.linker);
        await persistConfig(ctx, next);
        for (const registration of previous) {
          if (registration.trackingId !== provisional.trackingId) {
            await ctx.repositoryTracker.remove(registration.trackingId, consumer);
          }
        }
        await writeGitIgnore(ctx.projectRoot, next.references?.dir ?? DEFAULT_REFERENCES_DIR);
        await writeWorkspaceExclusions(
          ctx.projectRoot,
          next.references?.dir ?? DEFAULT_REFERENCES_DIR,
        );
        ctx.logger.success(`added reference "${name}"`);
      } catch (error) {
        const now = await ctx.repositoryTracker.listRegistrations(consumer);
        if (!now.some((registration) => registration.trackingId === provisional.trackingId)) {
          await ctx.repositoryTracker.remove(provisional.trackingId, buildConsumer(ctx, name));
        }
        throw error;
      }
    },
  },
  remove: {
    name: "remove",
    description: "Remove a reference link and release its shared checkout",
    args: [
      { name: "ref", required: true, description: "Declared reference name or unique source URL" },
    ],
    async run(ctx) {
      const [selector] = ctx.args;
      if (!selector || ctx.args.length !== 1)
        throw new Error("references remove expects one reference");
      const config = await readConfigOrDefault(ctx.configPath);
      const name = resolveName(config, selector);
      const request = config.references?.sources?.[name];
      if (!request) return;
      if (ctx.dryRun) {
        ctx.logger.info(`would: remove reference "${name}"`);
        return;
      }
      const route = await validateRouteSafety(ctx, config);
      const link = path.join(route, name);
      const stat = await fs.lstat(link).catch(() => null);
      const consumer = buildConsumer(ctx, name);
      const registrations = await ctx.repositoryTracker.listRegistrations(consumer);
      if (registrations.length === 0)
        throw new Error(
          `missing tracking metadata for reference "${name}"; run "agnos references --init" first`,
        );
      if (stat?.isSymbolicLink()) await removeOwnedLink(link, ctx.storeDir);
      for (const registration of registrations)
        await ctx.repositoryTracker.remove(registration.trackingId, consumer);
      const sources = Object.fromEntries(
        Object.entries(config.references?.sources ?? {}).filter(
          ([sourceName]) => sourceName !== name,
        ),
      );
      await persistConfig(ctx, { ...config, references: { ...config.references, sources } });
      ctx.logger.success(`removed reference "${name}"`);
    },
  },
  pull: {
    name: "pull",
    description: "Update one or all unpinned references",
    args: [{ name: "ref", required: false, description: "Reference name or unique source URL" }],
    async run(ctx) {
      if (ctx.args.length > 1) throw new Error("references pull accepts at most one reference");
      const config = await readConfigOrDefault(ctx.configPath);
      const sources = config.references?.sources ?? {};
      const names = ctx.args[0] ? [resolveName(config, ctx.args[0])] : Object.keys(sources);
      const failures: Error[] = [];
      for (const name of names) {
        const request = sources[name];
        if (!request) continue;
        if (ctx.dryRun) {
          ctx.logger.info(
            request.commit
              ? `would: skip pinned reference "${name}"`
              : `would: pull reference "${name}"`,
          );
          continue;
        }
        try {
          const registrations = await ctx.repositoryTracker.listRegistrations(
            buildConsumer(ctx, name),
          );
          const registration = registrations.find((item) => item.request.source === request.source);
          if (!registration)
            throw new Error(`reference "${name}" is not installed; run "agnos references --init"`);
          if (request.commit) {
            ctx.logger.info(`skipped pinned reference "${name}"`);
            continue;
          }
          const updated = await ctx.repositoryTracker.update(registration.trackingId);
          if (updated.entries.length !== 1 || updated.entries[0]?.kind !== "directory") {
            throw new Error(
              `selection is missing or no longer resolves to one directory; declaration retained`,
            );
          }
          ctx.logger.success(`updated reference "${name}"`);
        } catch (error) {
          const failure = error instanceof Error ? error : new Error(String(error));
          failures.push(failure);
          ctx.logger.error(`failed to pull reference "${name}": ${failure.message}`);
        }
      }
      if (failures.length > 0)
        throw new AggregateError(failures, "one or more references failed to pull");
    },
  },
};

const referencesDomain: Domain = {
  id: "references",
  description: "Track shared repository references",
  kind: "writer",
  priority: 60,
  color: "cyan",
  commands,
  initSteps: [
    {
      id: "directory",
      type: "text",
      message: "Reference links directory (relative to project root):",
      default: async (ctx) =>
        (ctx.config ?? (await readConfigOrDefault(ctx.configPath))).references?.dir ??
        DEFAULT_REFERENCES_DIR,
      async callback(value, ctx) {
        const config = ctx.config ?? (await readConfigOrDefault(ctx.configPath));
        const route = value.trim() || DEFAULT_REFERENCES_DIR;
        const next: AgnosConfig = { ...config, references: { ...config.references, dir: route } };
        await validateRouteSafety(ctx, next);
        if (ctx.dryRun) {
          ctx.logger.info(`would: set references.dir = ${route}`);
          return;
        }
        await writeConfig(ctx.configPath, next);
        await installDeclared(next, ctx);
        await writeGitIgnore(ctx.projectRoot, route);
        await writeWorkspaceExclusions(ctx.projectRoot, route);
      },
    },
  ],
  async run(_opts, ctx) {
    const config = await readConfigOrDefault(ctx.configPath);
    for (const name of Object.keys(config.references?.sources ?? {})) {
      if (ctx.dryRun) {
        ctx.logger.info(`would: check reference "${name}" freshness`);
        continue;
      }
      try {
        const expectedLink = path.join(resolveDirectory(ctx, config), name);
        const registrations = await ctx.repositoryTracker.listRegistrations(
          buildConsumer(ctx, name),
        );
        const registration = registrations.find(
          (item) => item.request.source === config.references?.sources?.[name]?.source,
        );
        if (!registration || !(await fs.lstat(expectedLink).catch(() => null))) {
          ctx.logger.warn(`reference "${name}" is not installed; run "agnos references --init"`);
          continue;
        }
        if (await ctx.repositoryTracker.shouldUpdate(registration.trackingId)) {
          ctx.logger.warn(`reference "${name}" is behind; run "agnos references pull ${name}"`);
        } else {
          ctx.logger.success(`reference "${name}" is up to date`);
        }
      } catch (error) {
        ctx.logger.warn(`reference "${name}" status unknown: ${(error as Error).message}`);
      }
    }
    return undefined;
  },
};

async function writeGitIgnore(projectRoot: string, route: string): Promise<void> {
  const file = path.join(projectRoot, ".gitignore");
  const current = await fs.readFile(file, "utf8").catch(() => "");
  const patterns = [`/${route.replace(/\\/g, "/").replace(/^\.\//, "")}/`];
  const lines = current.split(/\r?\n/);
  const missing = patterns.filter((pattern) => !lines.includes(pattern));
  if (missing.length === 0) return;
  await fs.writeFile(
    file,
    `${current}${current && !current.endsWith("\n") ? "\n" : ""}${missing.join("\n")}\n`,
  );
}

async function removeOwnedLink(link: string, storeDir: string): Promise<void> {
  const stat = await fs.lstat(link).catch(() => null);
  if (!stat?.isSymbolicLink()) return;
  const target = await fs.readlink(link);
  const repositoryRoot = path.resolve(storeDir, "repositories");
  const resolvedTarget = path.resolve(path.dirname(link), target);
  if (resolvedTarget !== repositoryRoot && !resolvedTarget.startsWith(repositoryRoot + path.sep)) {
    throw new Error(`reference link "${link}" does not point into the Agnos repository store`);
  }
  await fs.unlink(link);
}

async function writeWorkspaceExclusions(projectRoot: string, route: string): Promise<void> {
  const packagePath = path.join(projectRoot, "package.json");
  const packageData = await fs.readFile(packagePath, "utf8").catch(() => null);
  if (packageData) {
    const pkg = JSON.parse(packageData) as Record<string, unknown>;
    const workspace = pkg["workspaces"];
    const workspaces = Array.isArray(workspace)
      ? workspace
      : workspace && typeof workspace === "object"
        ? (workspace as Record<string, unknown>)["packages"]
        : undefined;
    if (Array.isArray(workspaces)) {
      const excluded = `!${route.replace(/\\/g, "/")}/**`;
      if (!workspaces.includes(excluded)) {
        const next = [...workspaces, excluded];
        if (Array.isArray(workspace)) pkg["workspaces"] = next;
        else pkg["workspaces"] = { ...(workspace as Record<string, unknown>), packages: next };
        await fs.writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
      }
    }
  }
  const pnpmPath = path.join(projectRoot, "pnpm-workspace.yaml");
  const pnpm = await fs.readFile(pnpmPath, "utf8").catch(() => null);
  if (!pnpm) return;
  const workspace = load(pnpm) as unknown;
  if (!workspace || typeof workspace !== "object" || Array.isArray(workspace)) {
    throw new Error("pnpm-workspace.yaml must contain a mapping");
  }
  const config = workspace as Record<string, unknown>;
  const packages = config["packages"];
  if (packages === undefined) return;
  if (!Array.isArray(packages) || !packages.every((entry) => typeof entry === "string")) {
    throw new Error("pnpm-workspace.yaml packages must be a list of patterns");
  }
  const excluded = `!${route.replace(/\\/g, "/")}/**`;
  if (packages.includes(excluded)) return;
  await fs.writeFile(pnpmPath, dump({ ...config, packages: [...packages, excluded] }));
}

export { referencesDomain };
export default referencesDomain;
