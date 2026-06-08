export type {
  AgentPaths,
  AgentPlugin,
  AgentRef,
  AgnosConfig,
  CliCommand,
  CliCommandArgs,
  DomainEventHandlers,
  DomainPlugin,
  HookHandler,
  HookMatcherGroup,
  HooksDeclaration,
  HooksEventHandlers,
  InitStep,
  InitStepBase,
  InitStepDefault,
  LinkKind,
  Linker,
  LockFile,
  Logger,
  MaterializeContext,
  McpDeclaration,
  McpEventHandlers,
  ParsedSourceRef,
  PluginManifest,
  RepoFetcher,
  ResolveContext,
  ResolvedMcp,
  ResolvedRule,
  ResolvedSkill,
  RulesDeclaration,
  RulesEventHandlers,
  SkillLockEntry,
  SkillsConfig,
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
  SCHEMA_URL,
} from "./config.js";
export {
  buildResolveContext,
  ensureSymlinkPrivileges,
  rebuildContextWithCopyFallback,
  resetSymlinkDecisionCache,
  workspaceRelativePath,
} from "./context.js";
export { loadPlugins, refToId, resolveAgentByRef } from "./plugin-loader.js";
export { runDomainInitSteps, runAllDomainInitSteps } from "./commands/init-steps.js";
export type { RunStepsOptions } from "./commands/init-steps.js";
export { ensureStarterRules } from "./commands/init.js";
export type { PluginRegistry, RegisteredAgent, RegisteredDomain } from "./plugin-loader.js";
export { createLinker, describeSymlinkFailure, ensureLink } from "./fs/link.js";
export type { EnsureLinkResult } from "./fs/link.js";
export {
  resolveRules,
  resolveRuleEntry,
  materializeRuleMirrors,
  pruneRuleMirrors,
} from "./materialize-rules.js";
export type { AgentRuleTarget } from "./materialize-rules.js";
export { createRepoFetcher, gigetTarballPath } from "./resolver.js";
export { parseSource, parseCompositeSkillRef, isProvider, SUPPORTED_PROVIDERS } from "./source.js";
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
  resolveSkill,
  uninstallAgent,
} from "./orchestrator.js";
export {
  activeAgents,
  dispatchMcpAdded,
  dispatchMcpRemoved,
  dispatchMcpUpdated,
  dispatchRules,
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
  hookHandlerSchema,
  hookMatcherGroupSchema,
  hooksConfigSchema,
  lockFileSchema,
  mcpDeclarationSchema,
  rulesDeclarationSchema,
  skillLockEntrySchema,
  skillNameSchema,
  skillRefSchema,
  skillSourcesSchema,
  skillsConfigSchema,
} from "./schema.js";
