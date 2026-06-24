import type { RegisteredAgent, RegisteredDomain } from "./core/plugin-loader.js";
import claudeCode from "./agents/claude-code/index.js";
import codex from "./agents/codex/index.js";
import docs from "./domains/docs/index.js";
import hooks from "./domains/hooks/index.js";
import mcp from "./domains/mcp/index.js";
import rules from "./domains/rules/index.js";
import skills from "./domains/skills/index.js";

/**
 * Static registry of built-in agents and domains. Replaces the former
 * node_modules `package.json#agnos` discovery — agnos now ships as a single
 * package with a fixed, closed set of agents and domains. Synthetic package
 * names (`@luxia/agnos#<id>`) keep `agentsByPackage`/ref resolution working.
 *
 * Loaded lazily by `loadPlugins` (see plugin-loader.ts) to avoid an init cycle
 * with the core barrel.
 */
export const BUILTIN_AGENTS: RegisteredAgent[] = [
  { plugin: claudeCode, packageName: "@luxia/agnos#claude-code", source: "project" },
  { plugin: codex, packageName: "@luxia/agnos#codex", source: "project" },
];

export const BUILTIN_DOMAINS: RegisteredDomain[] = [
  { plugin: rules, packageName: "@luxia/agnos#rules", source: "project" },
  { plugin: mcp, packageName: "@luxia/agnos#mcp", source: "project" },
  { plugin: hooks, packageName: "@luxia/agnos#hooks", source: "project" },
  { plugin: skills, packageName: "@luxia/agnos#skills", source: "project" },
  { plugin: docs, packageName: "@luxia/agnos#docs", source: "project" },
];
