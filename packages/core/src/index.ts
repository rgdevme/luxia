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
  LockFile,
  Logger,
  MaterializeContext,
  McpDeclaration,
  McpEventHandlers,
  ParsedSourceRef,
  PathsConfig,
  PluginManifest,
  RepoFetcher,
  ResolveContext,
  ResolvedMcp,
  ResolvedRule,
  ResolvedSkill,
  RulesDeclaration,
  RulesEventHandlers,
  SkillLockEntry,
  SkillsEventHandlers,
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
export { createRepoFetcher } from "./resolver.js";
export {
  parseSource,
  parseCompositeSkillRef,
  isProvider,
  SUPPORTED_PROVIDERS,
} from "./source.js";
export type {
  ParsedSource,
  GitSource,
  LocalSource,
  Provider,
  CompositeSkillRef,
} from "./source.js";
export { resolveGitCommit, resolveLocalCommit } from "./commit-resolver.js";
export type { CommitResolution } from "./commit-resolver.js";
export { findSkillsInRepo } from "./skill-discovery.js";
export type { DiscoveredSkill } from "./skill-discovery.js";
export { hashSkillDir } from "./skill-hash.js";
export { prepareSkills } from "./skill-prepare.js";
export type { PrepareResult } from "./skill-prepare.js";
export {
  LOCK_FILE,
  emptyLock,
  getSkill,
  lockPath,
  readLock,
  removeSkill,
  upsertSkill,
  writeLock,
} from "./lock.js";
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
  lockFileSchema,
  mcpDeclarationSchema,
  pathsConfigSchema,
  rulesDeclarationSchema,
  skillLockEntrySchema,
  skillNameSchema,
  skillRefSchema,
  skillsConfigSchema,
} from "./schema.js";
