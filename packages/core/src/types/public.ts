import type { z } from "zod";

export type AgentRef = string | { id: string; package: string };

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
}

export interface MaterializeContext extends ResolveContext {
  agentId: string;
}

export interface CliCommandArgs {
  positional: string[];
  flags: Record<string, unknown>;
}

export interface CliCommand {
  description: string;
  run(args: CliCommandArgs, ctx: ResolveContext): Promise<void>;
}

// Built-in command names a domain plugin cannot shadow via its `cli` map.
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
   * Called the first time a project encounters this domain (i.e., when the
   * domain id is not yet recorded in `.agnos/state.json#initializedDomains`).
   * Idempotent; allowed to no-op.
   */
  onInitialize?(ctx: ResolveContext): Promise<void>;

  /**
   * Resolve a declaration into a concrete item (with absolute paths, etc.).
   * Used by the orchestrator when computing replay state.
   */
  resolve?(decl: TDecl, ctx: ResolveContext): Promise<TItem>;

  // CLI-facing state mutators. Each mutates `.agnos/` + `agnos.json` and
  // returns the changed item. The orchestrator dispatches matching events
  // after these complete.
  add?(input: string, ctx: ResolveContext): Promise<TItem>;
  update?(name: string, ctx: ResolveContext): Promise<TItem>;
  remove?(name: string, ctx: ResolveContext): Promise<void>;
  /** Rules-specific: move source path (called when `rules.source` changes). */
  move?(from: string, to: string, ctx: ResolveContext): Promise<void>;
  list?(ctx: ResolveContext): Promise<TItem[]>;

  /**
   * Optional CLI subcommands exposed under `agnos <domain-id> <subcommand>`.
   * The special key `"default"` is invoked when no subcommand is supplied.
   */
  cli?: Record<string, CliCommand>;
}

// ---------- Agent plugin ----------

export interface RulesEventHandlers {
  onAdded?(decl: ResolvedRule, ctx: MaterializeContext): Promise<void>;
  onMoved?(from: ResolvedRule, to: ResolvedRule, ctx: MaterializeContext): Promise<void>;
  onRemoved?(decl: ResolvedRule, ctx: MaterializeContext): Promise<void>;
}

export interface McpEventHandlers {
  onAdded?(item: ResolvedMcp, ctx: MaterializeContext): Promise<void>;
  onUpdated?(item: ResolvedMcp, ctx: MaterializeContext): Promise<void>;
  onRemoved?(name: string, ctx: MaterializeContext): Promise<void>;
}

export interface SkillsEventHandlers {
  onAdded?(item: ResolvedSkill, ctx: MaterializeContext): Promise<void>;
  onUpdated?(item: ResolvedSkill, ctx: MaterializeContext): Promise<void>;
  onRemoved?(name: string, ctx: MaterializeContext): Promise<void>;
}

export interface DomainEventHandlers {
  rules?: RulesEventHandlers;
  mcp?: McpEventHandlers;
  skills?: SkillsEventHandlers;
}

/**
 * Snapshot of the project state passed to `agent.onReplay`.
 * `rules` may be undefined if no rules source is set yet.
 */
export interface AgentReplayState {
  rules?: ResolvedRule;
  mcp: ResolvedMcp[];
  skills: ResolvedSkill[];
}

export interface AgentPlugin {
  id: string;
  displayName: string;

  /** First time this agent id appears in `.agnos/state.json#installedAgents`. */
  onInstalled?(ctx: ResolveContext): Promise<void>;
  /** Joined `agnos.json.agents`. */
  onActivated?(ctx: ResolveContext): Promise<void>;
  /** Left `agnos.json.agents`. Cleanup runs here. */
  onDeactivated?(ctx: MaterializeContext): Promise<void>;
  /** Before `pnpm remove`. Removes anything `onDeactivated` left behind. */
  onUninstalled?(ctx: MaterializeContext): Promise<void>;

  /**
   * Bring this agent up to date with the full current state. Called:
   *  - after `onActivated` for newly-selected agents,
   *  - on every `agnos install` for each active agent,
   *  - after `agnos agent add`.
   * Idempotent. The single-write outputs (`CLAUDE.md`, `.mcp.json`,
   * `.codex/config.toml`) are produced here.
   */
  onReplay?(state: AgentReplayState, ctx: MaterializeContext): Promise<void>;

  /** Per-event handlers fired in response to CLI mutations on a domain. */
  handles?: DomainEventHandlers;
}

export interface PluginManifest {
  type: "agent" | "domain";
  id: string;
}
