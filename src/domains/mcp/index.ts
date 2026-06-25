import type { Domain, McpDeclaration } from "../../core/index.js";
import { jsonEqual, mergeByIdentity, type ArrayMergeResult, type MergePolicy } from "../merge.js";

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

/**
 * The mcp domain: a config writer. It owns `agnos.json#mcp`; the agents domain
 * renders each declaration into per-agent native files (`.mcp.json` /
 * `.codex/config.toml`). The `add`/`remove`/`update`/`migrate` subcommands are
 * wired in M8 (CLI); the reconcilers above are their data layer.
 */
export const mcpDomain: Domain = {
  id: "mcp",
  description: "Manage MCP servers in agnos.json (rendered per-agent by the agents domain)",
  kind: "writer",
  priority: 40,
};

export default mcpDomain;
