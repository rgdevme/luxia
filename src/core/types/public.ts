import type { z } from "zod";

/**
 * An entry in `agnos.json.agents`. Either an agent id (e.g. "claude-code") or
 * a full npm package name (e.g. "@me/agnos-agent-zed") — used when two
 * installed plugins claim the same id and need disambiguation.
 */
export type AgentRef = string;

export interface DocsConfig {
  /** Docs directory, relative to project root. Defaults to ".docs". */
  root?: string;
}

export interface AgnosConfig {
  $schema?: string;
  /** Required on disk (see config.ts); optional here so in-memory literals stay terse. */
  schemaVersion?: number;
  agents?: AgentRef[];
  rules?: RulesDeclaration;
  skills?: SkillsConfig;
  mcp?: McpDeclaration[];
  hooks?: HooksDeclaration;
  docs?: DocsConfig;
  [domain: string]: unknown;
}

export interface SkillsConfig {
  /** Canonical skills directory, relative to project root. Defaults to ".agnos/skills". */
  route?: string;
  /**
   * Map of local skill name → composite source ref.
   *
   * Value grammar:
   *   - git: `<provider>:<owner>/<repo>/<in-repo-path>[#<ref>]`
   *     e.g. `github:vercel-labs/agent-skills/skills/pdf`
   *     The `#<ref>` (branch/tag/commit) suffix is optional; when omitted the
   *     skill follows the repository's default branch (resolved at fetch time).
   *   - local: `file:<path-to-skill-dir>` (the directory contains SKILL.md directly)
   */
  sources?: Record<string, string>;
}

export interface SkillLockEntry {
  /** SHA-256 hex of the materialized skill directory's contents. */
  computedHash: string;
  /** ISO timestamp of when this hash was last computed. Informational. */
  resolvedAt: string;
  /** Upstream commit the skill resolved to (used by the `version` freshness check). */
  resolvedCommit?: string;
  /** Tracked symbolic ref (branch/tag) the skill follows. */
  ref?: string;
}

export interface LockFile {
  version: 1;
  /** Keyed by the composite source string (same value as `AgnosConfig.skills[name]`). */
  skills: Record<string, SkillLockEntry>;
}

export interface RulesDeclaration {
  /**
   * Map of canonical rules file → injectable fragment files. The rules domain
   * injects each fragment as a titled section into its canonical file.
   */
  files: Record<string, string[]>;
}

export interface McpDeclaration {
  name: string;
  /** Registry reverse-DNS identifier (e.g. `io.github.user/weather`). Set iff the server came from the MCP registry; absent for manually-added servers. */
  source?: string;
  /** Installed registry server version, used to detect updates. Set alongside `source`. */
  version?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** HTTP headers for remote (sse/http) transports — e.g. auth tokens. */
  headers?: Record<string, string>;
  transport?: "stdio" | "sse" | "http";
}

// ---------- Hooks domain ----------

/**
 * Canonical, normalized vocabulary of hook events — the union of every event
 * any supported agent exposes. Each adapter maps these to its native names via
 * {@link HookEventMap}; events an agent lacks are simply not rendered to it.
 */
export type HookEvent =
  | "PreToolUse"
  | "PostToolUse"
  | "UserPromptSubmit"
  | "Notification"
  | "Stop"
  | "SubagentStop"
  | "PreCompact"
  | "SessionStart"
  | "SessionEnd"
  | "BeforeModel"
  | "AfterModel"
  | "BeforeToolSelection";

/**
 * An agent's hook-event mapping: canonical {@link HookEvent} → the agent's own
 * native event name. A present key means the agent supports that event (and the
 * value is what to write in its native config); an absent key means it doesn't.
 */
export type HookEventMap = Partial<Record<HookEvent, string>>;

/**
 * A single hook entry — a flat, strict 5-field shape. Agents render it into
 * their native format (regrouping by event/matcher as needed). `message` is
 * user-facing status text; agents without an equivalent ignore it. Identity for
 * dedup/removal is `(event, matcher, command)`.
 */
export interface HookEntry {
  event: HookEvent;
  matcher?: string;
  type: "command";
  command: string;
  message?: string;
}

/** The canonical hooks registry stored under `agnos.json#hooks`: a flat array. */
export type HooksDeclaration = HookEntry[];

export interface ResolvedRule {
  /** Absolute path to the canonical source file (`<root>/<dir>/<filename>`). */
  absolutePath: string;
  /** Canonical path relative to the project root (for logging). */
  relativeSource: string;
  /**
   * The logical dir this rule belongs to, relative to `root` (and to each
   * agent's materialization root). "." for the root file; may contain "..".
   */
  dir: string;
  /** Canonical basename (`rules.filename`). */
  filename: string;
}

export interface ResolvedSkill {
  name: string;
  absolutePath: string;
}

export interface ResolvedMcp extends McpDeclaration {
  resolvedPackageDir?: string;
}

/** A domain's identity color, used (dimmed) for its `[domain]` log prefix. */
export type DomainColor =
  | "cyan"
  | "magenta"
  | "green"
  | "blue"
  | "yellow"
  | "gray"
  | "white"
  | "red";

/**
 * Structured payload for a log line, rendered as `[domain] message [status]`
 * with any `extra` lines below it (see {@link Logger}). A plain string is
 * shorthand for `{ message }`.
 */
export interface LogParts {
  /** The primary text, colored by log level. */
  message: string;
  /** Optional trailing status, rendered italic + dimmed (e.g. "changed"). */
  status?: string;
  /** Optional detail lines, rendered white below the message (e.g. a file list). */
  extra?: string | string[];
}

export type LogInput = string | LogParts;

/**
 * A log call that owns an async task. While `waitFor` is pending a spinner shows
 * the message (in the standardized shape); on resolution the spinner clears (or
 * is replaced by `done`) and the method returns the resolved value — so it
 * doubles as the `await`.
 */
export interface LogTask<T> extends LogParts {
  waitFor: Promise<T>;
  /** Line to replace the spinner with on success. Omit to just clear it. */
  done?: LogInput | ((value: T) => LogInput);
}

export interface Logger {
  info<T>(msg: LogTask<T>): Promise<T>;
  info(msg: LogInput): void;
  warn<T>(msg: LogTask<T>): Promise<T>;
  warn(msg: LogInput): void;
  error<T>(msg: LogTask<T>): Promise<T>;
  error(msg: LogInput): void;
  debug<T>(msg: LogTask<T>): Promise<T>;
  debug(msg: LogInput): void;
  success<T>(msg: LogTask<T>): Promise<T>;
  success(msg: LogInput): void;
}

export type LinkKind = "symlink" | "junction" | "hardlink" | "copy";

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
  ): Promise<{ path: string; ref?: string }>;
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
    })
  | (InitStepBase & {
      type: "multiselect";
      choices: { name: string; value: string; description?: string; checked?: boolean }[];
      default?: InitStepDefault<string[]>;
      callback(value: string[], ctx: ResolveContext): Promise<void>;
    });

export interface DomainPlugin<TDecl = unknown, TItem = unknown> {
  name: string;
  // Input type is `any` so schemas may apply `.default()`/`.transform()` (whose
  // parsed output is TDecl but whose input shape differs from TDecl).
  declarationSchema: z.ZodType<TDecl, z.ZodTypeDef, any>;

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
  /**
   * Bring this agent up to date with the rules domain. Receives the full set of
   * resolved canonical rule files (one per root + each `dirs` entry). Empty when
   * no rules are configured. The agent materializes its own filename next to (or
   * in a parallel tree for) each canonical file and prunes its stale mirrors.
   */
  onInitialize?(state: ResolvedRule[], ctx: MaterializeContext): Promise<void>;
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
  /**
   * This agent's own rule-file basename (e.g. "CLAUDE.md", "AGENTS.md"). The
   * rules domain materializes a mirror at `<rulesRoot>/<dir>/<rulesFilename>`
   * for every canonical rule file. Read by core to prune mirrors without
   * invoking the agent.
   */
  rulesFilename?: string;
  /**
   * Project-relative base dir where this agent reads its rule files. Defaults to
   * ".". Mirrors are materialized under this root, mirroring the canonical
   * `dirs` structure.
   */
  rulesRoot?: string;
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

// ---------- v0.1 contracts (defined here; consumed in M3–M8) ----------

export type FlagType = "boolean" | "string";

/** A declared CLI flag. Global flags are declared once; commands add their own. */
export interface FlagSpec {
  name: string;
  type: FlagType;
  alias?: string;
  description: string;
  default?: boolean | string;
}

/** A declared positional argument. */
export interface ArgSpec {
  name: string;
  required: boolean;
  variadic?: boolean;
  description: string;
}

/** Normalized global flags every command receives, plus any command-local flags. */
export interface ParsedFlags {
  dry: boolean;
  once: boolean;
  quiet: boolean;
  help: boolean;
  init: boolean;
  yes: boolean;
  [local: string]: unknown;
}

export interface RunContext extends ResolveContext {
  flags: ParsedFlags;
}

export interface CommandContext extends ResolveContext {
  args: string[];
  flags: ParsedFlags;
}

/** A declared subcommand exposed under `agnos <domain> <name>`. */
export interface CommandSpec {
  name: string;
  description: string;
  args?: ArgSpec[];
  flags?: FlagSpec[];
  run(ctx: CommandContext): Promise<void>;
}

export interface DomainRunOptions {
  dry: boolean;
  once: boolean;
  quiet: boolean;
  interactive: boolean;
}

/** Handle for a running domain watch process. */
export interface DomainRunHandle {
  done: Promise<void>;
  close(): Promise<void>;
}

/**
 * A domain in the writer/reader model. Config-writer domains manage their slice
 * of `agnos.json`; the single config-reader domain (`agents`) renders per-agent
 * files. `run` is the watch/once process; `commands` are the subcommands.
 */
export interface Domain {
  id: string;
  description: string;
  kind: "writer" | "reader";
  priority: number;
  /** Identity color for this domain's `[domain]` log prefix. Defaults to gray. */
  color?: DomainColor;
  run?(opts: DomainRunOptions, ctx: RunContext): Promise<DomainRunHandle | undefined>;
  /**
   * Absolute content paths this domain watches in watch mode (besides
   * `agnos.json`). Directories are watched recursively. Returning an empty list
   * (or omitting the method) means the domain contributes no content watcher —
   * it is either purely config-driven or CLI-driven. The supervisor re-runs this
   * domain (and every downstream domain) when any returned path changes.
   */
  watchPaths?(config: AgnosConfig, ctx: ResolveContext): string[] | Promise<string[]>;
  /**
   * Absolute paths under `watchPaths` to exclude from the watcher — typically a
   * domain's own generated output that lives inside a watched directory (e.g.
   * docs' `index.md`), so writing it does not re-trigger the domain.
   */
  watchIgnore?(config: AgnosConfig, ctx: ResolveContext): string[] | Promise<string[]>;
  initSteps?: InitStep[];
  commands?: Record<string, CommandSpec>;
}

/**
 * A per-agent adapter owned by the `agents` domain. Renders resolved config
 * slices into the agent's native files, scrapes them back for migrate/import,
 * and declares the output paths it owns (for shared-artifact-aware cleanup).
 */
export interface AgentAdapter {
  id: string;
  displayName: string;
  paths?: AgentPaths;
  /**
   * Canonical→native hook-event mapping. Declared once here and consumed by the
   * shared hooks machinery for render/scrape and by `hooks add` to warn which
   * installed agents don't support a given event. Omit for agents with no hook
   * system (they support no events).
   */
  hookEvents?: HookEventMap;
  /** Render a resolved slice (keyed by domain id) into this agent's native files. */
  render?: Record<string, (state: unknown, ctx: MaterializeContext) => Promise<void>>;
  /** Scrape this agent's native files back into agnos.json declarations (keyed by domain id). */
  scrape?: Record<string, (ctx: MaterializeContext) => Promise<unknown>>;
  /** Project-relative output paths this agent owns, used to avoid deleting shared artifacts. */
  claims?(ctx: MaterializeContext): string[] | Promise<string[]>;
}
