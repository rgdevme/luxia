import type { HarnessAdapter, Domain, Logger } from "./types/public.js";

export interface RegisteredHarness {
  adapter: HarnessAdapter;
  packageName: string;
}

export interface RegisteredDomain {
  domain: Domain;
  packageName: string;
}

export interface PluginRegistry {
  harnesses: Map<string, RegisteredHarness>;
  harnessesByPackage: Map<string, RegisteredHarness>;
  domains: Map<string, RegisteredDomain>;
  collisions: { type: "harness" | "domain"; id: string; packages: string[] }[];
}

interface LoaderOptions {
  projectRoot: string;
  logger: Logger;
}

/**
 * Build the plugin registry from the static set of built-ins. Loaded lazily
 * from `../registry.js` (see the note in registry.ts) to avoid an init cycle
 * with the core barrel.
 */
export async function loadPlugins(_opts: LoaderOptions): Promise<PluginRegistry> {
  const { BUILTIN_HARNESSES, BUILTIN_DOMAINS } = await import("../registry.js");

  const harnesses = new Map<string, RegisteredHarness>();
  const harnessesByPackage = new Map<string, RegisteredHarness>();
  const domains = new Map<string, RegisteredDomain>();

  for (const reg of BUILTIN_HARNESSES) {
    harnesses.set(reg.adapter.id, reg);
    harnessesByPackage.set(reg.packageName, reg);
  }
  for (const reg of BUILTIN_DOMAINS) {
    domains.set(reg.domain.id, reg);
  }

  return { harnesses, harnessesByPackage, domains, collisions: [] };
}

/** Look up an agent by id or by synthetic package name. */
export function resolveHarnessByRef(
  registry: PluginRegistry,
  ref: string,
): RegisteredHarness | undefined {
  return registry.harnesses.get(ref) ?? registry.harnessesByPackage.get(ref);
}

/** Resolve the canonical harness id for a ref; falls back to the ref itself. */
export function harnessRefToId(registry: PluginRegistry, ref: string): string {
  const reg = registry.harnesses.get(ref) ?? registry.harnessesByPackage.get(ref);
  return reg ? reg.adapter.id : ref;
}

/** Ordered domains by ascending priority (the run-pipeline order). */
export function orderedDomains(registry: PluginRegistry): RegisteredDomain[] {
  return [...registry.domains.values()].sort((a, b) => a.domain.priority - b.domain.priority);
}
