import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import type {
  AgentPlugin,
  DomainPlugin,
  Logger,
  PluginManifest,
} from "./types/public.js";

export interface RegisteredAgent {
  plugin: AgentPlugin;
  packageName: string;
}

export interface RegisteredDomain {
  plugin: DomainPlugin;
  packageName: string;
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
}

export async function loadPlugins({ projectRoot, logger }: LoaderOptions): Promise<PluginRegistry> {
  const pkgJsonPath = path.join(projectRoot, "package.json");
  let pkg: PackageJson;
  try {
    pkg = JSON.parse(await fs.readFile(pkgJsonPath, "utf8")) as PackageJson;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      logger.debug(`no package.json at ${pkgJsonPath} — no plugins loaded`);
      return emptyRegistry();
    }
    throw err;
  }

  const directDeps = collectDirectDeps(pkg);
  const requireFromProject = createRequire(path.join(projectRoot, "package.json"));

  const agents = new Map<string, RegisteredAgent>();
  const agentsByPackage = new Map<string, RegisteredAgent>();
  const domains = new Map<string, RegisteredDomain>();
  const seenAgents = new Map<string, string[]>();
  const seenDomains = new Map<string, string[]>();

  for (const depName of directDeps) {
    const depPkgPath = resolvePackageJson(requireFromProject, depName);
    if (!depPkgPath) continue;
    const depPkg = JSON.parse(await fs.readFile(depPkgPath, "utf8")) as PackageJson;
    const manifest = depPkg.agnos;
    if (!manifest?.type || !manifest?.id) continue;

    const entryPath = resolveModuleEntry(requireFromProject, depName, depPkg, depPkgPath);
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
          const reg: RegisteredAgent = { plugin: plugin as AgentPlugin, packageName: depName };
          agents.set(manifest.id, reg);
          agentsByPackage.set(depName, reg);
        }
      } else if (manifest.type === "domain") {
        const seen = seenDomains.get(manifest.id) ?? [];
        seen.push(depName);
        seenDomains.set(manifest.id, seen);
        if (!domains.has(manifest.id)) {
          domains.set(manifest.id, { plugin: plugin as DomainPlugin, packageName: depName });
        }
      }
    } catch (err) {
      logger.error(`failed to load plugin ${depName}: ${(err as Error).message}`);
    }
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

function emptyRegistry(): PluginRegistry {
  return { agents: new Map(), agentsByPackage: new Map(), domains: new Map(), collisions: [] };
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

export function resolveAgentByRef(
  registry: PluginRegistry,
  ref: string | { id: string; package: string },
): RegisteredAgent | undefined {
  if (typeof ref === "string") {
    return registry.agents.get(ref) ?? registry.agentsByPackage.get(ref);
  }
  return registry.agentsByPackage.get(ref.package) ?? registry.agents.get(ref.id);
}

export function refToId(ref: string | { id: string; package: string }): string {
  return typeof ref === "string" ? ref : ref.id;
}
