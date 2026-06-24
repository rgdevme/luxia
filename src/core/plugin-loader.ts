import type { AgentPlugin, DomainPlugin, Logger } from "./types/public.js";

/**
 * Origin of a registered plugin. In the single-package build every plugin is a
 * built-in, but the field is retained so existing call sites (e.g. the agents
 * picker) keep type-checking without change.
 */
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
}

/**
 * Build the plugin registry from the static set of built-ins.
 *
 * The built-in list lives in `../registry.js` and is imported lazily here: the
 * core barrel (`./index.js`) re-exports this module, and the built-in plugins
 * import that barrel, so a static import would form an initialization cycle.
 * Loading the registry at call time — after all module bodies have run —
 * sidesteps it.
 */
export async function loadPlugins(_opts: LoaderOptions): Promise<PluginRegistry> {
  const { BUILTIN_AGENTS, BUILTIN_DOMAINS } = await import("../registry.js");

  const agents = new Map<string, RegisteredAgent>();
  const agentsByPackage = new Map<string, RegisteredAgent>();
  const domains = new Map<string, RegisteredDomain>();

  for (const reg of BUILTIN_AGENTS) {
    agents.set(reg.plugin.id, reg);
    agentsByPackage.set(reg.packageName, reg);
  }
  for (const reg of BUILTIN_DOMAINS) {
    domains.set(reg.plugin.name, reg);
  }

  return { agents, agentsByPackage, domains, collisions: [] };
}

/**
 * Look up an agent by `agnos.json.agents` entry. Tries id first, then package
 * name (the package name is synthetic for built-ins but kept for parity).
 */
export function resolveAgentByRef(
  registry: PluginRegistry,
  ref: string,
): RegisteredAgent | undefined {
  return registry.agents.get(ref) ?? registry.agentsByPackage.get(ref);
}

/**
 * Resolve the canonical agent id for a ref. Falls back to the ref itself when
 * not found (caller will discover this is a missing plugin later).
 */
export function refToId(registry: PluginRegistry, ref: string): string {
  const reg = registry.agents.get(ref) ?? registry.agentsByPackage.get(ref);
  return reg ? reg.plugin.id : ref;
}
