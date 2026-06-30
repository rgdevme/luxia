import colors from "yoctocolors-cjs";
import type {
  AgnosConfig,
  CommandContext,
  CommandSpec,
  Domain,
  McpDeclaration,
} from "../../core/index.js";
import { readConfigOrDefault } from "../../core/index.js";
import { jsonEqual, mergeByIdentity, type ArrayMergeResult, type MergePolicy } from "../merge.js";
import {
  MIGRATE_FLAGS,
  confirmPrompt,
  multiSelect,
  multiSelectExclusive,
  policyFromFlags,
  selectPrompt,
  textPrompt,
  writeChange,
} from "../cli-helpers.js";
import { scrapeActive } from "../agents/index.js";
import {
  dedupeName,
  getServerLatest,
  isNewer,
  localNameFor,
  searchServers,
  toDeclarations,
  type RegistryServer,
} from "./registry.js";

/** Identity of an MCP declaration for dedup/removal: its name. */
export const mcpIdentity = (m: McpDeclaration): string => m.name;

/** Reconcile discovered MCP servers into the existing list (§13.5). */
export function mergeMcp(
  existing: McpDeclaration[],
  discovered: McpDeclaration[],
  policy: MergePolicy,
): ArrayMergeResult<McpDeclaration> {
  return mergeByIdentity(existing, discovered, mcpIdentity, jsonEqual, policy);
}

/** Remove an MCP server by name. */
export function removeMcp(existing: McpDeclaration[], name: string): McpDeclaration[] {
  return existing.filter((m) => m.name !== name);
}

function nonInteractive(ctx: CommandContext): boolean {
  return Boolean(ctx.flags["yes"]) || !process.stdin.isTTY;
}

function isRemote(transport: McpDeclaration["transport"]): boolean {
  return transport === "sse" || transport === "http";
}

function confirmMessage(server: RegistryServer): string {
  const title = server.title ?? server.name;
  const desc = server.description ? `\n  ${colors.dim(server.description)}` : "";
  return `Add ${title} ${colors.dim(server.name)}?${desc}`;
}

async function pickServers(
  ctx: CommandContext,
  results: RegistryServer[],
  installed: ReadonlySet<string>,
): Promise<string[]> {
  const choices = results.map((s) => {
    const isInstalled = installed.has(s.name);
    return {
      name: `${s.title ?? s.name} ${colors.dim(s.name)}`,
      value: s.name,
      checked: isInstalled,
      disabled: isInstalled,
      ...(s.description ? { description: s.description } : {}),
    };
  });
  return multiSelectExclusive(
    ctx,
    "Select MCP servers to add (installed are greyed out):",
    choices,
    "specify a search term that narrows to one server, or run in a terminal to pick interactively",
  );
}

async function resolveDeployment(
  ctx: CommandContext,
  server: RegistryServer,
): Promise<McpDeclaration | undefined> {
  const candidates = toDeclarations(server);
  if (candidates.length === 0) {
    ctx.logger.warn(`${server.name} declares no installable package or remote; skipping`);
    return undefined;
  }
  if (candidates.length === 1) return candidates[0]!.build();
  const picked = await selectPrompt(
    ctx,
    `Choose how to run ${server.title ?? server.name}:`,
    candidates.map((c, i) => ({ name: c.label, value: String(i) })),
  );
  return candidates[Number(picked)]!.build();
}

function collectPlaceholders(decl: McpDeclaration, into: string[]): void {
  for (const [key, value] of Object.entries(decl.env ?? {})) {
    if (value === "") into.push(`${decl.name}.env.${key}`);
  }
  for (const [key, value] of Object.entries(decl.headers ?? {})) {
    if (value === "") into.push(`${decl.name}.headers.${key}`);
  }
}

async function addFromRegistry(
  ctx: CommandContext,
  config: AgnosConfig,
  mcp: McpDeclaration[],
  term: string,
): Promise<void> {
  ctx.logger.info(`searching the MCP registry for "${term}"…`);
  const results = await searchServers(term);
  if (results.length === 0) {
    ctx.logger.info(
      `no servers found for "${term}". Run \`agnos mcp add\` with no term to configure one manually.`,
    );
    return;
  }
  const installed = new Set(mcp.filter((m) => m.source).map((m) => m.source!));

  let chosen: RegistryServer[];
  if (nonInteractive(ctx)) {
    chosen = results.filter((s) => !installed.has(s.name));
    if (chosen.length === 0) {
      ctx.logger.info("all matching servers are already installed");
      return;
    }
  } else if (results.length === 1) {
    const only = results[0]!;
    if (installed.has(only.name)) {
      ctx.logger.info(`${only.title ?? only.name} (${only.name}) is already installed`);
      return;
    }
    if (!(await confirmPrompt(ctx, confirmMessage(only), true))) {
      ctx.logger.info("nothing selected");
      return;
    }
    chosen = [only];
  } else {
    const names = await pickServers(ctx, results, installed);
    chosen = results.filter((s) => names.includes(s.name));
  }
  if (chosen.length === 0) {
    ctx.logger.info("nothing selected");
    return;
  }

  const taken = new Set(mcp.map((m) => m.name));
  const additions: McpDeclaration[] = [];
  const placeholders: string[] = [];
  for (const server of chosen) {
    const decl = await resolveDeployment(ctx, server);
    if (!decl) continue;
    decl.name = dedupeName(localNameFor(server.name), taken);
    taken.add(decl.name);
    additions.push(decl);
    collectPlaceholders(decl, placeholders);
  }
  if (additions.length === 0) {
    ctx.logger.info("nothing to add");
    return;
  }

  await writeChange(
    ctx,
    `added ${additions.length} mcp server(s): ${additions.map((d) => d.name).join(", ")}`,
    { ...config, mcp: [...mcp, ...additions] },
  );
  if (placeholders.length > 0) {
    ctx.logger.info(`fill in before use: ${placeholders.join(", ")}`);
  }
}

async function promptKeyValues(
  ctx: CommandContext,
  kind: string,
): Promise<Record<string, string> | undefined> {
  const out: Record<string, string> = {};
  for (;;) {
    const key = (
      await textPrompt(ctx, `Add ${kind} (name, blank to finish):`, { default: "" })
    ).trim();
    if (!key) break;
    out[key] = await textPrompt(ctx, `Value for ${key}:`, { default: "" });
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

async function addManually(
  ctx: CommandContext,
  config: AgnosConfig,
  mcp: McpDeclaration[],
): Promise<void> {
  if (nonInteractive(ctx)) {
    throw new Error("manual mcp config needs an interactive terminal (or pass a search term)");
  }
  const transport = await selectPrompt(ctx, "Transport:", [
    { name: "stdio (local command)", value: "stdio" as const },
    { name: "http (remote)", value: "http" as const },
    { name: "sse (remote)", value: "sse" as const },
  ]);
  const taken = new Set(mcp.map((m) => m.name));
  const name = (
    await textPrompt(ctx, "Server name:", {
      validate: (v) => {
        const t = v.trim();
        if (!t) return "name is required";
        if (taken.has(t)) return `"${t}" already exists`;
        return true;
      },
    })
  ).trim();

  const decl: McpDeclaration = { name, transport };
  if (transport === "stdio") {
    decl.command = (
      await textPrompt(ctx, "Command:", {
        validate: (v) => (v.trim() ? true : "command is required"),
      })
    ).trim();
    const argsLine = (
      await textPrompt(ctx, "Args (space-separated, optional):", { default: "" })
    ).trim();
    const args = argsLine ? argsLine.split(/\s+/) : [];
    if (args.length > 0) decl.args = args;
    const env = await promptKeyValues(ctx, "env var");
    if (env) decl.env = env;
  } else {
    decl.command = (
      await textPrompt(ctx, "URL:", { validate: (v) => (v.trim() ? true : "url is required") })
    ).trim();
    const headers = await promptKeyValues(ctx, "header");
    if (headers) decl.headers = headers;
    const env = await promptKeyValues(ctx, "env var");
    if (env) decl.env = env;
  }

  await writeChange(ctx, `added mcp server "${decl.name}"`, { ...config, mcp: [...mcp, decl] });
}

function mergeValues(
  next: Record<string, string> | undefined,
  existing: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!next) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(next)) {
    const prev = existing?.[key];
    out[key] = prev ? prev : value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function rebuildFrom(latest: RegistryServer, existing: McpDeclaration): McpDeclaration | undefined {
  const built = toDeclarations(latest).map((c) => c.build());
  const wantRemote = isRemote(existing.transport);
  const match = built.find((d) => isRemote(d.transport) === wantRemote) ?? built[0];
  if (!match) return undefined;
  match.name = existing.name;
  const env = mergeValues(match.env, existing.env);
  if (env) match.env = env;
  else delete match.env;
  const headers = mergeValues(match.headers, existing.headers);
  if (headers) match.headers = headers;
  else delete match.headers;
  return match;
}

function resolveUpdateTargets(mcp: McpDeclaration[], ids: string[]): McpDeclaration[] {
  const managed = mcp.filter((m) => m.source);
  if (ids.length === 0) return managed;
  const byName = new Map(mcp.map((m) => [m.name, m]));
  const bySource = new Map(managed.map((m) => [m.source!, m]));
  const resolved: McpDeclaration[] = [];
  const unknown: string[] = [];
  const unmanaged: string[] = [];
  for (const id of ids) {
    const hit = byName.get(id) ?? bySource.get(id);
    if (!hit) unknown.push(id);
    else if (!hit.source) unmanaged.push(id);
    else resolved.push(hit);
  }
  if (unknown.length > 0) throw new Error(`mcp server(s) not found: ${unknown.join(", ")}`);
  if (unmanaged.length > 0) {
    throw new Error(`not registry-managed (no source to update from): ${unmanaged.join(", ")}`);
  }
  return resolved;
}

const commands: Record<string, CommandSpec> = {
  add: {
    name: "add",
    description: "Add MCP servers from the registry (search), or configure one manually",
    args: [
      {
        name: "term",
        required: false,
        description: "registry search term (omit for interactive manual config)",
      },
    ],
    async run(ctx) {
      const config = await readConfigOrDefault(ctx.configPath);
      const mcp = config.mcp ?? [];
      const term = ctx.args[0];
      if (term) await addFromRegistry(ctx, config, mcp, term);
      else await addManually(ctx, config, mcp);
    },
  },
  update: {
    name: "update",
    description: "Update registry-managed MCP servers to their latest version (all if none given)",
    args: [
      {
        name: "names",
        required: false,
        variadic: true,
        description: "servers to update (default: all)",
      },
    ],
    async run(ctx) {
      const config = await readConfigOrDefault(ctx.configPath);
      const mcp = config.mcp ?? [];
      if (!mcp.some((m) => m.source)) {
        ctx.logger.info("no registry-managed mcp servers to update");
        return;
      }
      const targets = resolveUpdateTargets(mcp, ctx.args);
      const updates = new Map<string, McpDeclaration>();
      let current = 0;
      let missing = 0;
      for (const decl of targets) {
        const latest = await getServerLatest(decl.source!);
        if (!latest) {
          ctx.logger.warn(`${decl.name}: no longer in registry (${decl.source})`);
          missing++;
          continue;
        }
        if (decl.version && !isNewer(latest.version, decl.version)) {
          current++;
          continue;
        }
        const rebuilt = rebuildFrom(latest, decl);
        if (rebuilt) {
          updates.set(decl.name, rebuilt);
          ctx.logger.info(`${decl.name}: ${decl.version ?? "?"} → ${latest.version}`);
        } else {
          ctx.logger.warn(`${decl.name}: latest version has no matching deployment; skipped`);
        }
      }
      if (updates.size === 0) {
        const extra = missing > 0 ? `, ${missing} missing` : "";
        ctx.logger.info(`all up to date (${current} current${extra})`);
        return;
      }
      await writeChange(
        ctx,
        `updated ${updates.size} mcp server(s): ${[...updates.keys()].join(", ")}`,
        { ...config, mcp: mcp.map((m) => updates.get(m.name) ?? m) },
      );
    },
  },
  remove: {
    name: "remove",
    description: "Remove MCP servers (multiselect prompt when no name is given)",
    args: [
      {
        name: "names",
        required: false,
        variadic: true,
        description: "server names (omit to pick)",
      },
    ],
    async run(ctx) {
      const config = await readConfigOrDefault(ctx.configPath);
      const mcp = config.mcp ?? [];
      if (mcp.length === 0) {
        ctx.logger.info("no mcp servers to remove");
        return;
      }
      let targets = ctx.args;
      if (targets.length === 0) {
        targets = await multiSelect(
          ctx,
          "Select MCP servers to remove:",
          mcp.map((m) => ({
            name: `${m.name}  (${m.source ?? m.command ?? m.transport ?? "stdio"})`,
            value: m.name,
          })),
          "specify server name(s) to remove, or run in a terminal to pick them",
        );
      }
      if (targets.length === 0) {
        ctx.logger.info("nothing selected");
        return;
      }
      const present = new Set(mcp.map((m) => m.name));
      const missing = targets.filter((n) => !present.has(n));
      if (missing.length > 0) throw new Error(`mcp server(s) not found: ${missing.join(", ")}`);
      await writeChange(ctx, `removed ${targets.length} mcp server(s): ${targets.join(", ")}`, {
        ...config,
        mcp: mcp.filter((m) => !targets.includes(m.name)),
      });
    },
  },
  migrate: {
    name: "migrate",
    description: "Import MCP servers from the active agents' native config",
    flags: MIGRATE_FLAGS,
    async run(ctx) {
      const discovered = (await scrapeActive("mcp", ctx)) as McpDeclaration[];
      const config = await readConfigOrDefault(ctx.configPath);
      const res = mergeMcp(config.mcp ?? [], discovered, policyFromFlags(ctx));
      if (res.aborted) {
        throw new Error(
          `mcp migrate aborted: ${res.conflicts} conflict(s). Re-run with --force or --missing.`,
        );
      }
      await writeChange(ctx, `mcp migrate: +${res.added} added, ${res.overwritten} overwritten`, {
        ...config,
        mcp: res.items,
      });
    },
  },
};

/**
 * The mcp domain: a config writer. It owns `agnos.json#mcp`; the agents domain
 * renders each declaration into per-agent native files. Subcommands mutate the
 * config; the agents domain materializes on the next run.
 */
export const mcpDomain: Domain = {
  id: "mcp",
  description: "Manage MCP servers in agnos.json (rendered per-agent by the agents domain)",
  kind: "writer",
  priority: 40,
  commands,
};

export default mcpDomain;
