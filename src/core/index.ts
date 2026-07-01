export type {
  AgentAdapter,
  AgentRef,
  AgnosConfig,
  ArgSpec,
  CommandContext,
  CommandSpec,
  Domain,
  DomainRunHandle,
  DomainRunOptions,
  FlagSpec,
  FlagType,
  HookEntry,
  HookEvent,
  HooksDeclaration,
  InitStep,
  InitStepBase,
  InitStepDefault,
  LinkKind,
  Linker,
  LockFile,
  Logger,
  MaterializeContext,
  McpDeclaration,
  ParsedFlags,
  ParsedSourceRef,
  RepoFetcher,
  ResolveContext,
  ResolvedMcp,
  ResolvedSkill,
  RulesDeclaration,
  RunContext,
  SkillLockEntry,
  SkillsConfig,
} from "./types/public.js";

export { createLogger, createSpinner, dim, withSpinner } from "./logger.js";
export type { Spinner } from "./logger.js";
export { exclusiveCheckbox } from "./prompts.js";
export type { ExclusiveChoice, ExclusiveConfig, PickChoice } from "./prompts.js";
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
export { buildResolveContext, workspaceRelativePath } from "./context.js";
export { loadPlugins, orderedDomains, refToId, resolveAgentByRef } from "./plugin-loader.js";
export type { PluginRegistry, RegisteredAgent, RegisteredDomain } from "./plugin-loader.js";
export { runAll, runOne, runFrom } from "./run.js";
export { runDomainInitSteps, runAllDomainInitSteps } from "./commands/init-steps.js";
export type { RunStepsOptions } from "./commands/init-steps.js";
export { createLinker, describeSymlinkFailure, ensureLink } from "./fs/link.js";
export type { EnsureLinkResult } from "./fs/link.js";
export { importMcpServers, pickEnv, pickStringArray } from "./agent-helpers.js";
export { createRepoFetcher } from "./resolver.js";
export {
  parseSource,
  parseCompositeSkillRef,
  isProvider,
  SUPPORTED_PROVIDERS,
  FALLBACK_REF,
} from "./source.js";
export type {
  ParsedSource,
  GitSource,
  LocalSource,
  Provider,
  CompositeSkillRef,
} from "./source.js";
export { resolveGitCommit, resolveLocalCommit, resolveDefaultBranch } from "./commit-resolver.js";
export type { CommitResolution } from "./commit-resolver.js";
export { findSkillsInRepo, readSkillMeta } from "./skill-discovery.js";
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
  docFrontmatterSchema,
  docsConfigSchema,
  hookEntrySchema,
  hookEventSchema,
  hooksConfigSchema,
  lockFileSchema,
  mcpDeclarationSchema,
  rulesDeclarationSchema,
  SCHEMA_VERSION,
  skillLockEntrySchema,
  skillNameSchema,
  skillRefSchema,
  skillSourcesSchema,
  skillsConfigSchema,
} from "./schema.js";
