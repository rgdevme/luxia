import type { CommandSpec, Domain, McpDeclaration } from "../../core/index.js";
import { readConfigOrDefault } from "../../core/index.js";
import { jsonEqual, mergeByIdentity, type ArrayMergeResult, type MergePolicy } from "../merge.js";
import {
  MIGRATE_FLAGS,
  multiSelect,
  policyFromFlags,
  reqArg,
  writeChange,
} from "../cli-helpers.js";
import { scrapeActive } from "../agents/index.js";

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

function declFrom(name: string, command: string, args: string[]): McpDeclaration {
  const decl: McpDeclaration = { name, command, transport: "stdio" };
  if (args.length > 0) decl.args = args;
  return decl;
}

const commands: Record<string, CommandSpec> = {
  add: {
    name: "add",
    description: "Add a stdio MCP server",
    args: [
      { name: "name", required: true, description: "server name" },
      { name: "command", required: true, description: "executable to run" },
      { name: "args", required: false, variadic: true, description: "command arguments" },
    ],
    async run(ctx) {
      const name = reqArg(ctx, 0, "name");
      const command = reqArg(ctx, 1, "command");
      const config = await readConfigOrDefault(ctx.configPath);
      const mcp = config.mcp ?? [];
      if (mcp.some((m) => m.name === name)) {
        throw new Error(`mcp server "${name}" already exists (use \`agnos mcp update\`)`);
      }
      await writeChange(ctx, `added mcp server "${name}"`, {
        ...config,
        mcp: [...mcp, declFrom(name, command, ctx.args.slice(2))],
      });
    },
  },
  update: {
    name: "update",
    description: "Replace an existing stdio MCP server",
    args: [
      { name: "name", required: true, description: "server name" },
      { name: "command", required: true, description: "executable to run" },
      { name: "args", required: false, variadic: true, description: "command arguments" },
    ],
    async run(ctx) {
      const name = reqArg(ctx, 0, "name");
      const command = reqArg(ctx, 1, "command");
      const config = await readConfigOrDefault(ctx.configPath);
      const mcp = config.mcp ?? [];
      if (!mcp.some((m) => m.name === name)) throw new Error(`mcp server "${name}" not found`);
      const next = declFrom(name, command, ctx.args.slice(2));
      await writeChange(ctx, `updated mcp server "${name}"`, {
        ...config,
        mcp: mcp.map((m) => (m.name === name ? next : m)),
      });
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
            name: `${m.name}  (${m.command ?? m.transport ?? "stdio"})`,
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
