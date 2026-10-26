import type { RegisteredHarness, RegisteredDomain } from "./core/plugin-loader.js";
import { HARNESS_ADAPTERS } from "./harnesses/adapters/index.js";
import { harnessDomain } from "./domains/harness/index.js";
import docs from "./domains/docs/index.js";
import mcp from "./domains/mcp/index.js";
import rules from "./domains/rules/index.js";
import skills from "./domains/skills/index.js";
import references from "./domains/references/index.js";

/**
 * Static registry of built-in harness adapters and domains. The closed set —
 * agnos ships as a single package with a fixed roster. Synthetic package names
 * (`@luxia/agnos#<id>`) keep ref-by-package resolution working. Loaded lazily by
 * `loadPlugins` to avoid an init cycle with the core barrel.
 */
export const BUILTIN_HARNESSES: RegisteredHarness[] = HARNESS_ADAPTERS.map((adapter) => ({
  adapter,
  packageName: `@luxia/agnos#${adapter.id}`,
}));

// Domain order is informational; the orchestrator sorts by `priority`
// (skills=10 → docs=20 → rules=30 → mcp=40 → harness=99).
export const BUILTIN_DOMAINS: RegisteredDomain[] = [
  skills,
  docs,
  rules,
  mcp,
  references,
  harnessDomain,
].map((domain) => ({ domain, packageName: `@luxia/agnos#${domain.id}` }));
