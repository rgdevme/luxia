import type { z } from "zod";

/**
 * An entry in `agnos.json.agents`. Either an agent id (e.g. "claude-code") or
 * a full npm package name (e.g. "@me/agnos-agent-zed") — used when two
 * installed plugins claim the same id and need disambiguation.
 */
export type AgentRef = string;

export interface AgnosConfig {
  $schema?: string;
  agents?: AgentRef[];
  rules?: RulesDeclaration;
  skills?: SkillDeclaration[];
  mcp?: McpDeclaration[];
  [domain: string]: unknown;
}

export interface RulesDeclaration {
  source: string;
}

export interface SkillDeclaration {
  name: string;
  source: string;
}

export interface McpDeclaration {
  name: string;
  source?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  transport?: "stdio" | "sse" | "http";
}

export interface ResolvedRule {
  absolutePath: string;
  relativeSource: string;
}

export interface ResolvedSkill {
  name: string;
  absolutePath: string;
}

export interface ResolvedMcp extends McpDeclaration {
  resolvedPackageDir?: string;
}

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  debug(msg: string): void;
  success(msg: string): void;
}

export type LinkKind = "symlink" | "junction" | "copy";

export interface Linker {
  canSymlinkFiles(): Promise<boolean>;
  canSymlinkDirs(): Promise<boolean>;
  link(target: string, linkPath: string, opts?: { fallback?: "copy" }): Promise<{ kind: LinkKind }>;
  unlink(linkPath: string): Promise<void>;
}

export interface SourceResolver {
  resolve(source: string, destDir: string, opts?: { noCache?: boolean }): Promise<{ path: string }>;
}

export interface ResolveContext {
  agnosRoot: string;
  projectRoot: string;
  cacheDir: string;
  configPath: string;
  statePath: string;
  logger: Logger;
  fetcher: SourceResolver;
  linker: Linker;
  /** When true, mutation paths log "would: …" lines and skip side effects. */
  dryRun?: boolean;
  /** Prepended to every line a wrapped logger emits inside agent hooks. */
  indent?: string;
}

export interface MaterializeContext extends ResolveContext {
  agentId: string;
  indent: string;
}

export interface CliCommandArgs {
  positional: string[];
  flags: Record<string, unknown>;
}

export interface CliCommand {
  description: string;
  run(args: CliCommandArgs, ctx: ResolveContext): Promise<void>;
}

export const RESERVED_CLI_IDS = [
  "init",
  "rules",
  "agents",
  "agent",
  "skill",
  "mcp",
  "install",
] as const;

// ---------- Domain plugin ----------

export interface DomainPlugin<TDecl = unknown, TItem = unknown> {
  name: string;
  declarationSchema: z.ZodType<TDecl>;

  /**
   * Position in the lifecycle order. Lower numbers run first. The orchestrator
   * iterates domains by ascending priority for activation/initialization;
   * cleanup runs in descending order. Built-ins: rules=10, mcp=20, skills=30,
   * docs=40. Ties broken by plugin registration order.
   */
  priority: number;

  /** First-time project encounter; runs once per project (gated by state.json). */
  onInitialize?(ctx: ResolveContext): Promise<void>;

  /** Resolve a declaration into a concrete item. */
  resolve?(decl: TDecl, ctx: ResolveContext): Promise<TItem>;

  /** CLI-facing state mutators. Each mutates `.agnos/` + `agnos.json`. */
  add?(input: string, ctx: ResolveContext): Promise<TItem>;
  update?(name: string, ctx: ResolveContext): Promise<TItem>;
  remove?(name: string, ctx: ResolveContext): Promise<void>;
  /** Rules-specific. */
  move?(from: string, to: string, ctx: ResolveContext): Promise<void>;
  list?(ctx: ResolveContext): Promise<TItem[]>;

  /** Optional CLI subcommands exposed under `agnos <domain-id> <subcommand>`. */
  cli?: Record<string, CliCommand>;

  /**
   * Per-agent activation hook. Called after `onInitialize` (which runs once
   * per project) and before the agent's own `handles.<domain>.onInitialize`.
   * Lets a domain materialize per-agent artifacts (e.g. a directory-level
   * symlink) from declarative agent fields like `paths.skillsDir` without
   * requiring the agent to write any handler. Receives the full active-agent
   * list so the domain can dedupe across agents sharing the same target.
   */
  onAgentActivate?(
    agent: AgentPlugin,
    activeAgents: readonly AgentPlugin[],
    ctx: MaterializeContext,
  ): Promise<void>;

  /**
   * Per-agent deactivation hook. Called before the agent's own
   * `handles.<domain>.onCleanup`. `remainingAgents` is the active set with
   * the agent being deactivated removed, so the domain can decide whether to
   * keep shared artifacts in place.
   */
  onAgentDeactivate?(
    agent: AgentPlugin,
    remainingAgents: readonly AgentPlugin[],
    ctx: MaterializeContext,
  ): Promise<void>;
}

// ---------- Agent plugin: per-domain event handlers ----------

export interface RulesEventHandlers {
  /** Bring this agent up to date with the rules domain. Undefined when no rules set. */
  onInitialize?(state: ResolvedRule | undefined, ctx: MaterializeContext): Promise<void>;
  onAdded?(decl: ResolvedRule, ctx: MaterializeContext): Promise<void>;
  onMoved?(from: ResolvedRule, to: ResolvedRule, ctx: MaterializeContext): Promise<void>;
  onRemoved?(decl: ResolvedRule, ctx: MaterializeContext): Promise<void>;
  /** Strip this agent's rules-domain artifacts. Runs on deactivation. */
  onCleanup?(ctx: MaterializeContext): Promise<void>;
}

export interface McpEventHandlers {
  onInitialize?(state: ResolvedMcp[], ctx: MaterializeContext): Promise<void>;
  onAdded?(item: ResolvedMcp, ctx: MaterializeContext): Promise<void>;
  onUpdated?(item: ResolvedMcp, ctx: MaterializeContext): Promise<void>;
  onRemoved?(name: string, ctx: MaterializeContext): Promise<void>;
  onCleanup?(ctx: MaterializeContext): Promise<void>;
  /**
   * One-time reverse-import. Read the agent's own project-scoped MCP config
   * file(s), parse them, and return declarations to centralize into agnos.json.
   * Fires once per agent per project (gated by state.json) on first activation.
   * Return [] if the source file is absent or unparseable — do not throw.
   */
  onImport?(ctx: MaterializeContext): Promise<McpDeclaration[]>;
}

export interface SkillsEventHandlers {
  onInitialize?(state: ResolvedSkill[], ctx: MaterializeContext): Promise<void>;
  onAdded?(item: ResolvedSkill, ctx: MaterializeContext): Promise<void>;
  onUpdated?(item: ResolvedSkill, ctx: MaterializeContext): Promise<void>;
  onRemoved?(name: string, ctx: MaterializeContext): Promise<void>;
  onCleanup?(ctx: MaterializeContext): Promise<void>;
}

/**
 * Agents register per-domain handlers here. Built-in domains have typed keys
 * (`rules`, `mcp`, `skills`). Third-party domain plugins can add their own
 * typed keys via TS declaration merging:
 *
 * ```ts
 * // in `@user/agnos-domain-prompts`
 * declare module '@luxia/core' {
 *   interface DomainEventHandlers {
 *     prompts?: {
 *       onInitialize?(state: ResolvedPrompt[], ctx: MaterializeContext): Promise<void>;
 *       onAdded?(item: ResolvedPrompt, ctx: MaterializeContext): Promise<void>;
 *       // …
 *     };
 *   }
 * }
 * ```
 *
 * The orchestrator looks up handlers by string key, so even without
 * augmentation an agent can write `handles: { prompts: { onAdded: … } }` —
 * augmentation just gives you type-checking on the handler signatures.
 */
export interface DomainEventHandlers {
  rules?: RulesEventHandlers;
  mcp?: McpEventHandlers;
  skills?: SkillsEventHandlers;
}

/**
 * Declarative per-agent paths consumed by domain plugins. Built-in keys are
 * known to the standard domains; third-party domains can add their own via
 * declaration merging (same pattern as DomainEventHandlers).
 */
export interface AgentPaths {
  /** Project-relative directory the skills domain should link to `.agnos/skills/`. */
  skillsDir?: string;
}

export interface AgentPlugin {
  id: string;
  displayName: string;

  /**
   * Declarative paths a domain inspects to bootstrap per-agent artifacts
   * without requiring the agent to write a handler. See AgentPaths.
   */
  paths?: AgentPaths;

  /** Top-level lifecycle for non-domain-specific work. */
  onInstalled?(ctx: ResolveContext): Promise<void>;
  onUninstalled?(ctx: MaterializeContext): Promise<void>;

  /** Per-domain handlers — see DomainEventHandlers. */
  handles?: DomainEventHandlers;
}

export interface PluginManifest {
  type: "agent" | "domain";
  id: string;
}
