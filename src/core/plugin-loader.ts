import type { AgentAdapter, Domain, Logger } from "./types/public.js";

export interface RegisteredAgent {
  adapter: AgentAdapter;
  packageName: string;
}

export interface RegisteredDomain {
  domain: Domain;
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

/**
 * Build the plugin registry from the static set of built-ins. Loaded lazily
 * from `../registry.js` (see the note in registry.ts) to avoid an init cycle
 * with the core barrel.
 */
export async function loadPlugins(_opts: LoaderOptions): Promise<PluginRegistry> {
  const { BUILTIN_AGENTS, BUILTIN_DOMAINS } = await import("../registry.js");

  const agents = new Map<string, RegisteredAgent>();
  const agentsByPackage = new Map<string, RegisteredAgent>();
  const domains = new Map<string, RegisteredDomain>();

  for (const reg of BUILTIN_AGENTS) {
    agents.set(reg.adapter.id, reg);
    agentsByPackage.set(reg.packageName, reg);
  }
  for (const reg of BUILTIN_DOMAINS) {
    domains.set(reg.domain.id, reg);
  }

  return { agents, agentsByPackage, domains, collisions: [] };
}

/** Look up an agent by id or by synthetic package name. */
export function resolveAgentByRef(
  registry: PluginRegistry,
  ref: string,
): RegisteredAgent | undefined {
  return registry.agents.get(ref) ?? registry.agentsByPackage.get(ref);
}

/** Resolve the canonical agent id for a ref; falls back to the ref itself. */
export function refToId(registry: PluginRegistry, ref: string): string {
  const reg = registry.agents.get(ref) ?? registry.agentsByPackage.get(ref);
  return reg ? reg.adapter.id : ref;
}

/** Ordered domains by ascending priority (the run-pipeline order). */
export function orderedDomains(registry: PluginRegistry): RegisteredDomain[] {
  return [...registry.domains.values()].sort((a, b) => a.domain.priority - b.domain.priority);
}
