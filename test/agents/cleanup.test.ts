import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { AgentAdapter, AgnosConfig, MaterializeContext } from "../../src/core/index.js";
import { createLogger } from "../../src/core/index.js";
import { cleanupAgent, renderAgent } from "../../src/domains/agents/index.js";
import claudeCode from "../../src/agents/adapters/claude-code/index.js";

let tmp: string;

function ctxFor(root: string): MaterializeContext {
  return {
    agnosRoot: root,
    projectRoot: root,
    cacheDir: path.join(root, ".agnos", "cache"),
    configPath: path.join(root, "agnos.json"),
    statePath: path.join(root, ".agnos", "state.json"),
    logger: createLogger({ quiet: true }),
    fetcher: {} as never,
    linker: {} as never,
    dryRun: false,
    indent: "",
    agentId: "test",
  };
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-cleanup-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("cleanupAgent (claims-based)", () => {
  it("deletes the removed agent's owned paths but keeps paths a remaining agent claims", async () => {
    const ctx = ctxFor(tmp);
    const ownedOnly = path.join(tmp, "owned.txt");
    const shared = path.join(tmp, "shared.txt");
    await fs.writeFile(ownedOnly, "x");
    await fs.writeFile(shared, "y");

    const removed: AgentAdapter = {
      id: "a",
      displayName: "A",
      claims: () => [ownedOnly, shared],
    };
    const remaining: AgentAdapter = { id: "b", displayName: "B", claims: () => [shared] };

    await cleanupAgent(removed, [remaining], ctx);

    expect(
      await fs.access(ownedOnly).then(
        () => true,
        () => false,
      ),
    ).toBe(false); // deleted
    expect(
      await fs.access(shared).then(
        () => true,
        () => false,
      ),
    ).toBe(true); // kept (claimed by B)
  });

  it("removes a real adapter's owned files when no other agent remains", async () => {
    const ctx = ctxFor(tmp);
    await fs.writeFile(path.join(tmp, ".mcp.json"), "{}");
    await fs.mkdir(path.join(tmp, ".claude", "skills"), { recursive: true });

    await cleanupAgent(claudeCode, [], ctx);

    expect(
      await fs.access(path.join(tmp, ".mcp.json")).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
    expect(
      await fs.access(path.join(tmp, ".claude", "skills")).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
  });
});

describe("renderAgent", () => {
  it("drives the adapter's slices (mcp written from config)", async () => {
    const ctx = ctxFor(tmp);
    const config: AgnosConfig = {
      schemaVersion: 1,
      agents: ["claude-code"],
      mcp: [{ name: "fs", command: "pnpx" }],
    };
    await renderAgent(claudeCode, config, ctx);
    const written = JSON.parse(await fs.readFile(path.join(tmp, ".mcp.json"), "utf8"));
    expect(written.mcpServers.fs.command).toBe("pnpx");
  });
});
