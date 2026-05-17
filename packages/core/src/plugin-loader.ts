import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import type { AgentPlugin, DomainPlugin, Logger, PluginManifest } from "./types/public.js";

export type PluginSource = "project" | "bundle";

export interface RegisteredAgent {
  plugin: AgentPlugin;
  packageName: string;
  source: PluginSource;
}

export interface RegisteredDomain {
  plugin: DomainPlugin;
  packageName: string;
  source: PluginSource;
}

export interface PluginRegistry {
  agents: Map<string, RegisteredAgent>;
  agentsByPackage: Map<string, RegisteredAgent>;
  domains: Map<string, RegisteredDomain>;
  collisions: { type: "agent" | "domain"; id: string; packages: string[] }[];
}

interface LoaderOptions {
  projectRoot: string;
  logger: Logger;
  /**
   * Optional second root to scan after the project. Used by the `agnos`
   * meta-package to expose bundled default plugins when running globally
   * or in a project that hasn't installed them locally. Defaults to
   * `process.env.AGNOS_BUNDLE_ROOT`.
   */
  bundleRoot?: string;
}

export async function loadPlugins({
  projectRoot,
  logger,
  bundleRoot = process.env["AGNOS_BUNDLE_ROOT"],
}: LoaderOptions): Promise<PluginRegistry> {
  const agents = new Map<string, RegisteredAgent>();
  const agentsByPackage = new Map<string, RegisteredAgent>();
  const domains = new Map<string, RegisteredDomain>();
  const seenAgents = new Map<string, string[]>();
  const seenDomains = new Map<string, string[]>();

  await scanRoot({
    root: projectRoot,
    source: "project",
    logger,
    agents,
    agentsByPackage,
    domains,
    seenAgents,
    seenDomains,
  });

  if (bundleRoot && path.resolve(bundleRoot) !== path.resolve(projectRoot)) {
    await scanRoot({
      root: bundleRoot,
      source: "bundle",
      logger,
      agents,
      agentsByPackage,
      domains,
      // Bundle plugins fill gaps — they should never trigger collision
      // diagnostics against the project. Use isolated seen-maps so a
      // project plugin overriding a bundle plugin is silent.
      seenAgents: new Map(),
      seenDomains: new Map(),
    });
  }

  const collisions: PluginRegistry["collisions"] = [];
  for (const [id, packages] of seenAgents) {
    if (packages.length > 1) collisions.push({ type: "agent", id, packages });
  }
  for (const [id, packages] of seenDomains) {
    if (packages.length > 1) collisions.push({ type: "domain", id, packages });
  }

  return { agents, agentsByPackage, domains, collisions };
}

interface ScanArgs {
  root: string;
  source: PluginSource;
  logger: Logger;
  agents: Map<string, RegisteredAgent>;
  agentsByPackage: Map<string, RegisteredAgent>;
  domains: Map<string, RegisteredDomain>;
  seenAgents: Map<string, string[]>;
  seenDomains: Map<string, string[]>;
}

async function scanRoot(args: ScanArgs): Promise<void> {
  const { root, source, logger, agents, agentsByPackage, domains, seenAgents, seenDomains } = args;
  const pkgJsonPath = path.join(root, "package.json");
  let pkg: PackageJson;
  try {
    pkg = JSON.parse(await fs.readFile(pkgJsonPath, "utf8")) as PackageJson;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      logger.debug(`no package.json at ${pkgJsonPath} — skipping ${source} plugins`);
      return;
    }
    throw err;
  }

  const directDeps = collectDirectDeps(pkg);
  const requireFromRoot = createRequire(path.join(root, "package.json"));

  for (const depName of directDeps) {
    const depPkgPath = resolvePackageJson(requireFromRoot, depName);
    if (!depPkgPath) continue;
    const depPkg = JSON.parse(await fs.readFile(depPkgPath, "utf8")) as PackageJson;
    const manifest = depPkg.agnos;
    if (!manifest?.type || !manifest?.id) continue;

    const entryPath = resolveModuleEntry(requireFromRoot, depName, depPkg, depPkgPath);
    if (!entryPath) {
      logger.warn(`plugin ${depName} has agnos manifest but no resolvable entry`);
      continue;
    }

    try {
      const mod = (await import(pathToFileURL(entryPath).href)) as Record<string, unknown>;
      const plugin = mod["default"] ?? mod[manifest.id] ?? mod;

      if (manifest.type === "agent") {
        const seen = seenAgents.get(manifest.id) ?? [];
        seen.push(depName);
        seenAgents.set(manifest.id, seen);
        if (!agents.has(manifest.id)) {
          const reg: RegisteredAgent = {
            plugin: plugin as AgentPlugin,
            packageName: depName,
            source,
          };
          agents.set(manifest.id, reg);
          agentsByPackage.set(depName, reg);
        }
      } else if (manifest.type === "domain") {
        const seen = seenDomains.get(manifest.id) ?? [];
        seen.push(depName);
        seenDomains.set(manifest.id, seen);
        if (!domains.has(manifest.id)) {
          domains.set(manifest.id, {
            plugin: plugin as DomainPlugin,
            packageName: depName,
            source,
          });
        }
      }
    } catch (err) {
      logger.error(`failed to load plugin ${depName}: ${(err as Error).message}`);
    }
  }
}

interface PackageJson {
  name?: string;
  main?: string;
  module?: string;
  exports?: unknown;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  agnos?: PluginManifest;
}

function collectDirectDeps(pkg: PackageJson): string[] {
  const out = new Set<string>();
  for (const key of Object.keys(pkg.dependencies ?? {})) out.add(key);
  for (const key of Object.keys(pkg.devDependencies ?? {})) out.add(key);
  return [...out];
}

function resolvePackageJson(req: NodeRequire, depName: string): string | undefined {
  try {
    return req.resolve(`${depName}/package.json`);
  } catch {
    // some packages restrict subpath exports — walk up from the main entry
    try {
      const main = req.resolve(depName);
      let dir = path.dirname(main);
      for (let i = 0; i < 10; i++) {
        const candidate = path.join(dir, "package.json");
        if (existsSync(candidate)) return candidate;
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    } catch {
      // unresolvable
    }
    return undefined;
  }
}

function resolveModuleEntry(
  req: NodeRequire,
  depName: string,
  depPkg: PackageJson,
  pkgPath: string,
): string | undefined {
  try {
    return req.resolve(depName);
  } catch {
    // fall back to manual main/module
    const pkgDir = path.dirname(pkgPath);
    if (depPkg.module) {
      const candidate = path.join(pkgDir, depPkg.module);
      if (existsSync(candidate)) return candidate;
    }
    if (depPkg.main) {
      const candidate = path.join(pkgDir, depPkg.main);
      if (existsSync(candidate)) return candidate;
    }
    return undefined;
  }
}

/**
 * Look up an agent by `agnos.json.agents` entry. Tries id first, then package
 * name. (Used when a plugin id collision forces the user to write the full
 * package name as the agent ref.)
 */
export function resolveAgentByRef(
  registry: PluginRegistry,
  ref: string,
): RegisteredAgent | undefined {
  return registry.agents.get(ref) ?? registry.agentsByPackage.get(ref);
}

/**
 * Resolve the canonical agent id for a ref. If the ref is a package name,
 * returns the plugin's declared id. Falls back to the ref itself when not
 * found (caller will discover this is a missing plugin later).
 */
export function refToId(registry: PluginRegistry, ref: string): string {
  const reg = registry.agents.get(ref) ?? registry.agentsByPackage.get(ref);
  return reg ? reg.plugin.id : ref;
}
