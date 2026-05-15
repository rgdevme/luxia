export type {
  AgentPlugin,
  AgentRef,
  AgentSupports,
  AgnosConfig,
  CliCommand,
  CliCommandArgs,
  DomainHandler,
  DomainPlugin,
  LinkKind,
  Linker,
  Logger,
  MaterializeContext,
  McpDeclaration,
  PluginManifest,
  ResolveContext,
  ResolvedMcp,
  ResolvedRule,
  ResolvedSkill,
  RulesDeclaration,
  SkillDeclaration,
  SourceResolver,
} from "./types/public.js";
export { RESERVED_CLI_IDS } from "./types/public.js";

export { createLogger } from "./logger.js";
export { buildPaths, ensureDir, findProjectRoot, AGNOS_DIR, CONFIG_FILE, DEFAULT_RULES_FILE } from "./paths.js";
export { readConfig, readConfigOrDefault, writeConfig, configExists, DEFAULT_CONFIG } from "./config.js";
export { buildResolveContext, ensureSymlinkPrivileges, rebuildContextWithCopyFallback, workspaceRelativePath } from "./context.js";
export { loadPlugins, refToId, resolveAgentByRef } from "./plugin-loader.js";
export type { PluginRegistry, RegisteredAgent, RegisteredDomain } from "./plugin-loader.js";
export { createLinker, describeSymlinkFailure } from "./fs/link.js";
export { createSourceResolver } from "./resolver.js";
export { install, cleanupAgent, pruneAgentSkillDir } from "./orchestrator.js";
export {
  agentRefSchema,
  agnosConfigSchema,
  mcpDeclarationSchema,
  rulesDeclarationSchema,
  skillDeclarationSchema,
} from "./schema.js";
