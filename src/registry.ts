import type { RegisteredAgent, RegisteredDomain } from "./core/plugin-loader.js";
import { ADAPTERS } from "./agents/adapters/index.js";
import { agentsDomain } from "./domains/agents/index.js";
import docs from "./domains/docs/index.js";
import hooks from "./domains/hooks/index.js";
import mcp from "./domains/mcp/index.js";
import rules from "./domains/rules/index.js";
import skills from "./domains/skills/index.js";

/**
 * Static registry of built-in agents (adapters) and domains. The closed set —
 * agnos ships as a single package with a fixed roster. Synthetic package names
 * (`@luxia/agnos#<id>`) keep ref-by-package resolution working. Loaded lazily by
 * `loadPlugins` to avoid an init cycle with the core barrel.
 */
export const BUILTIN_AGENTS: RegisteredAgent[] = ADAPTERS.map((adapter) => ({
  adapter,
  packageName: `@luxia/agnos#${adapter.id}`,
}));

// Domain order is informational; the orchestrator sorts by `priority`
// (skills=10 → docs=20 → rules=30 → mcp=40 → hooks=50 → agents=99).
export const BUILTIN_DOMAINS: RegisteredDomain[] = [
  skills,
  docs,
  rules,
  mcp,
  hooks,
  agentsDomain,
].map((domain) => ({ domain, packageName: `@luxia/agnos#${domain.id}` }));
