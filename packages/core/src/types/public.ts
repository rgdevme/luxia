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
  skills?: SkillsConfig;
  mcp?: McpDeclaration[];
  hooks?: HooksDeclaration;
  [domain: string]: unknown;
}

export interface SkillsConfig {
  /** Canonical skills directory, relative to project root. Defaults to ".agnos/skills". */
  route?: string;
  /**
   * Map of local skill name → composite source ref.
   *
   * Value grammar:
   *   - git: `<provider>:<owner>/<repo>/<in-repo-path>`
   *     e.g. `github:vercel-labs/agent-skills/skills/pdf`
   *   - local: `file:<path-to-skill-dir>` (the directory contains SKILL.md directly)
   */
  sources?: Record<string, string>;
}

export interface SkillLockEntry {
  /** SHA-256 hex of the materialized skill directory's contents. */
  computedHash: string;
  /** ISO timestamp of when this hash was last computed. Informational. */
  resolvedAt: string;
}

export interface LockFile {
  version: 1;
  /** Keyed by the composite source string (same value as `AgnosConfig.skills[name]`). */
  skills: Record<string, SkillLockEntry>;
}

export interface RulesDeclaration {
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

// ---------- Hooks domain ----------

/**
 * A single hook handler. The structure mirrors Claude Code's hook entry — the
 * superset across agents: `type` is required (e.g. "command") and all other
 * fields are passed through verbatim so agent-specific keys (Codex's
 * `command_windows`, Claude's `if`/`once`/`async`/`statusMessage`, …) survive a
 * round-trip through the canonical registry.
 */
export interface HookHandler {
  type: string;
  [key: string]: unknown;
}

/**
 * A matcher group: a set of hook handlers gated by an optional `matcher`. What
 * the matcher filters depends on the event (tool name, source, trigger type).
 */
export interface HookMatcherGroup {
  matcher?: string;
  hooks: HookHandler[];
  [key: string]: unknown;
}

/**
 * The canonical hooks registry stored under `agnos.json#hooks`: a map of hook
 * event name (e.g. "PreToolUse", "SessionStart") to its matcher groups. Agents
 * materialize this into their own native format and location (Claude Code →
 * `.claude/settings.json#hooks`, Codex → `.codex/hooks.json`).
 */
export type HooksDeclaration = Record<string, HookMatcherGroup[]>;

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

/**
 * Repository fetcher. Materializes a parsed git or local source into a
 * cache-managed directory and returns the root path. The result represents
 * the repository root, not a specific skill — domains walk into it to find
 * what they need (e.g. domain-skills looks under `./skills/*`).
 */
export interface RepoFetcher {
  fetch(
    source: ParsedSourceRef,
    opts?: { ref?: string; noCache?: boolean },
  ): Promise<{ path: string }>;
}

/**
 * Structural type for parsed sources — kept here so external plugins can use
 * `ctx.fetcher.fetch` without importing internal helpers. The shape matches
 * `ParsedSource` in `source.ts`.
 */
export type ParsedSourceRef =
  | {
      kind: "git";
      provider: "github" | "gitlab" | "bitbucket";
      owner: string;
      repo: string;
      canonical: string;
    }
  | { kind: "local"; absolutePath: string; canonical: string };

export interface ResolveContext {
  agnosRoot: string;
  projectRoot: string;
  cacheDir: string;
  configPath: string;
  statePath: string;
  logger: Logger;
  fetcher: RepoFetcher;
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

/**
 * One interactive configuration step a domain plugin contributes to
 * `agnos init`. The runner prompts the user (or uses `default` under `-y`)
 * and calls `callback` with the resolved value. Callbacks are responsible
 * for persisting their value into `agnos.json`.
 */
export interface InitStepBase {
  /** Stable identifier for --only filtering and dry-run logging. Unique within the plugin. */
  id: string;
  message: string;
  /**
   * Predicate to gate the step. Returning `false` (or a falsy value) skips the
   * step entirely — no prompt and no callback fires. Useful for conditional
   * configuration (e.g. don't ask about rules-file injection when there is no
   * rules file).
   */
  when?(ctx: ResolveContext): boolean | Promise<boolean>;
}

/** A literal value or a function (sync or async) that returns one given the active context. */
export type InitStepDefault<T> = T | ((ctx: ResolveContext) => T | Promise<T>);

export type InitStep =
  | (InitStepBase & {
      type: "text";
      default?: InitStepDefault<string>;
      validate?(value: string): true | string;
      callback(value: string, ctx: ResolveContext): Promise<void>;
    })
  | (InitStepBase & {
      type: "boolean";
      default?: InitStepDefault<boolean>;
      callback(value: boolean, ctx: ResolveContext): Promise<void>;
    })
  | (InitStepBase & {
      type: "select";
      choices: { name: string; value: string }[];
      default?: InitStepDefault<string>;
      callback(value: string, ctx: ResolveContext): Promise<void>;
    });

export interface DomainPlugin<TDecl = unknown, TItem = unknown> {
  name: string;
  declarationSchema: z.ZodType<TDecl>;

  /**
   * Interactive setup steps. Run by `agnos init` in domain-priority order, and
   * by the auto-synthesized `agnos <domain> init` when the plugin doesn't
   * define its own `cli.init`.
   */
  initSteps?: InitStep[];

  /**
   * Returns the default starter content for a file this domain materializes
   * (e.g. AGENTS.md for the rules domain). Lets core write the starter file
   * via the loaded plugin instance instead of importing from the plugin's
   * package directly — avoids a workspace dependency cycle between core
   * and the plugin.
   */
  getStarterContent?(): string | Promise<string>;

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

  /**
   * Reverse-import merge. Given whatever this domain's agent
   * `handles.<domain>.onImport` returned, merge it into `config` (mutating in
   * place), validating against what's already declared so existing entries are
   * not blindly overwritten. Returns true if `config` was modified. The
   * orchestrator's one-time import pass calls this once per agent per project
   * (state-gated) for any domain that defines it.
   */
  importMerge?(
    imported: unknown,
    config: AgnosConfig,
    opts: { agentId: string; interactive: boolean },
    ctx: ResolveContext,
  ): Promise<boolean>;

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

export interface HooksEventHandlers {
  /** Materialize the canonical hooks registry into this agent's native file. */
  onInitialize?(state: HooksDeclaration | undefined, ctx: MaterializeContext): Promise<void>;
  /**
   * One-time reverse-import. Read this agent's native hook config, parse it, and
   * return a hooks registry to centralize into agnos.json. Fires once per agent
   * per project (state-gated) on first activation. Return {} if the source is
   * absent or unparseable — do not throw.
   */
  onImport?(ctx: MaterializeContext): Promise<HooksDeclaration>;
  /** Strip this agent's hooks-domain artifacts. Runs on deactivation. */
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
  hooks?: HooksEventHandlers;
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
