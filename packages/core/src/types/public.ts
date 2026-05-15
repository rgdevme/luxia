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
  logger: Logger;
  fetcher: SourceResolver;
  linker: Linker;
}

export interface MaterializeContext extends ResolveContext {
  agentId: string;
}

export type DomainHandler<TResolved> = (
  items: TResolved[],
  ctx: MaterializeContext,
) => Promise<void>;

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

export interface DomainPlugin<TDecl = unknown, TResolved = unknown> {
  name: string;
  declarationSchema: z.ZodType<TDecl>;
  resolve(decl: TDecl, ctx: ResolveContext): Promise<TResolved>;
  add(ref: string, ctx: ResolveContext): Promise<TDecl>;
  remove(name: string, ctx: ResolveContext): Promise<void>;
  update(name: string, ctx: ResolveContext): Promise<TResolved>;
  list(ctx: ResolveContext): Promise<TResolved[]>;
  /**
   * Optional CLI subcommands exposed under `agnos <domain-id> <subcommand>`.
   * The special key `"default"` is invoked when no subcommand is supplied.
   * A domain whose id matches a value in RESERVED_CLI_IDS is still loaded,
   * but its `cli` map cannot be reached from the CLI (the built-in wins).
   */
  cli?: Record<string, CliCommand>;
  /**
   * Called by `agnos init` after rules + agents have been configured.
   * Idempotent. Used by docs to scaffold .docs/ and inject markers.
   */
  onInit?(ctx: ResolveContext): Promise<void>;
}

export interface AgentSupports {
  rules?: DomainHandler<ResolvedRule>;
  mcp?: DomainHandler<ResolvedMcp>;
  skills?: DomainHandler<ResolvedSkill>;
  [domainName: string]: DomainHandler<never> | undefined;
}

export interface AgentPlugin {
  id: string;
  displayName: string;
  supports: AgentSupports;
  cleanup(ctx: MaterializeContext): Promise<void>;
}

export interface PluginManifest {
  type: "agent" | "domain";
  id: string;
}
