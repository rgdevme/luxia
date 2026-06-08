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
  /** Canonical basename for every rule file. Defaults to "AGENTS.md". */
  filename: string;
  /** Base dir for canonical sources. The root file is `<root>/<filename>`. Defaults to ".". */
  root: string;
  /** Additional dirs (relative to `root`) that each hold a `<filename>`. May contain "..". */
  dirs: string[];
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
