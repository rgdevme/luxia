export type {
  AgentPlugin,
  AgentRef,
  AgnosConfig,
  CliCommand,
  CliCommandArgs,
  DomainEventHandlers,
  DomainPlugin,
  LinkKind,
  Linker,
  Logger,
  MaterializeContext,
  McpDeclaration,
  McpEventHandlers,
  PluginManifest,
  ResolveContext,
  ResolvedMcp,
  ResolvedRule,
  ResolvedSkill,
  RulesDeclaration,
  RulesEventHandlers,
  SkillDeclaration,
  SkillsEventHandlers,
  SourceResolver,
} from "./types/public.js";
export { RESERVED_CLI_IDS } from "./types/public.js";

export { createLogger } from "./logger.js";
export {
  buildPaths,
  ensureDir,
  findProjectRoot,
  AGNOS_DIR,
  CONFIG_FILE,
  DEFAULT_RULES_FILE,
  STATE_FILE,
} from "./paths.js";
export {
  readConfig,
  readConfigOrDefault,
  writeConfig,
  configExists,
  DEFAULT_CONFIG,
} from "./config.js";
export {
  buildResolveContext,
  ensureSymlinkPrivileges,
  rebuildContextWithCopyFallback,
  resetSymlinkDecisionCache,
  workspaceRelativePath,
} from "./context.js";
export { loadPlugins, refToId, resolveAgentByRef } from "./plugin-loader.js";
export type { PluginRegistry, RegisteredAgent, RegisteredDomain } from "./plugin-loader.js";
export { createLinker, describeSymlinkFailure } from "./fs/link.js";
export { createSourceResolver } from "./resolver.js";
export {
  activateAgent,
  buildAgentDomainStates,
  cleanupAgent,
  initializeAgentsInterleaved,
  materializeAgent,
  orderedDomains,
  reconcile,
  reinstate,
  resolveRule,
  resolveSkill,
  uninstallAgent,
} from "./orchestrator.js";
export {
  activeAgents,
  dispatchMcpAdded,
  dispatchMcpRemoved,
  dispatchMcpUpdated,
  dispatchRulesAdded,
  dispatchRulesMoved,
  dispatchRulesRemoved,
  dispatchSkillAdded,
  dispatchSkillRemoved,
  dispatchSkillUpdated,
} from "./events.js";
export {
  isAgentInstalled,
  isDomainInitialized,
  markAgentInstalled,
  markDomainInitialized,
  readState,
  unmarkAgentInstalled,
  writeState,
} from "./state.js";
export type { AgnosState } from "./state.js";
export {
  agentRefSchema,
  agnosConfigSchema,
  mcpDeclarationSchema,
  rulesDeclarationSchema,
  skillDeclarationSchema,
} from "./schema.js";
