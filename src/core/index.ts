export type {
  HarnessAdapter,
  HarnessRef,
  AgnosConfig,
  RepositoryRequest,
  RepositoryConsumer,
  RepositoryTrackEntry,
  RepositoryTrackInfo,
  RepositoryRegistration,
  RepositoryTracker,
  ReferencesConfig,
  ArgSpec,
  CommandContext,
  CommandSpec,
  Domain,
  DomainRunHandle,
  DomainRunOptions,
  FlagSpec,
  FlagType,
  InitStep,
  InitStepBase,
  InitStepDefault,
  DomainColor,
  LinkKind,
  Linker,
  LockFile,
  Logger,
  LoggerProgress,
  LogInput,
  LogParts,
  LogTask,
  MaterializeContext,
  McpConfig,
  McpDeclaration,
  ParsedFlags,
  ParsedSourceRef,
  RepoFetcher,
  ResolveContext,
  ResolvedMcp,
  ResolvedSkill,
  SkillMetadataDiagnostic,
  SkillMetadataValidationInput,
  RulesDeclaration,
  RunContext,
  SkillLockEntry,
  SkillsConfig,
} from "./types/public.js";

export { createLogger, dim, formatLog, withDomain } from "./logger.js";
export { exclusiveCheckbox } from "./prompts.js";
export type { ExclusiveChoice, ExclusiveConfig, PickChoice } from "./prompts.js";
export {
  buildPaths,
  ensureDir,
  findProjectRoot,
  AGNOS_DIR,
  CONFIG_FILE,
  DEFAULT_RULES_FILE,
  DEFAULT_LOCAL_SKILLS_DIR,
  DEFAULT_REFERENCES_DIR,
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
export { resolveGlobalStoreDir } from "./store-path.js";
export { createRepositoryTracker } from "./repository-tracker.js";
export { migrateLegacySkillSources } from "./skill-migration.js";
export type { SkillMigrationResult } from "./skill-migration.js";
export type { GlobalStorePathOptions } from "./store-path.js";
export {
  loadPlugins,
  orderedDomains,
  harnessRefToId,
  resolveHarnessByRef,
} from "./plugin-loader.js";
export type { PluginRegistry, RegisteredHarness, RegisteredDomain } from "./plugin-loader.js";
export { runAll, runOne, runFrom } from "./run.js";
export { runDomainInitSteps, runAllDomainInitSteps } from "./commands/init-steps.js";
export type { RunStepsOptions } from "./commands/init-steps.js";
export { createLinker, describeSymlinkFailure, ensureLink } from "./fs/link.js";
export type { EnsureLinkResult } from "./fs/link.js";
export { importMcpServers, pickEnv, pickEnvKeys, pickStringArray } from "./agent-helpers.js";
export { createRepoFetcher } from "./resolver.js";
export {
  parseSource,
  parseCompositeSkillRef,
  parseSkillRequest,
  skillRequestKey,
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
export { parseSkillMetadata, validateSkillForHarnesses } from "./skill-metadata.js";
export type { ParsedSkillMetadata } from "./skill-metadata.js";
export { hashSkillDir } from "./skill-hash.js";
export { materializeSkill } from "./skill-materialize.js";
export type { MaterializeSkillResult } from "./skill-materialize.js";
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
  harnessRefSchema,
  agnosConfigSchema,
  docFrontmatterSchema,
  docsConfigSchema,
  lockFileSchema,
  mcpConfigSchema,
  mcpDeclarationSchema,
  rulesDeclarationSchema,
  SCHEMA_VERSION,
  skillLockEntrySchema,
  skillNameSchema,
  skillSourcesSchema,
  skillsConfigSchema,
  repositoryRequestSchema,
  repositorySourcesSchema,
  referencesConfigSchema,
} from "./schema.js";
