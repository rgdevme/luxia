import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { HarnessAdapter, AgnosConfig, MaterializeContext } from "../../src/core/index.js";
import { createLogger } from "../../src/core/index.js";
import { cleanupHarness, renderHarness } from "../../src/domains/harness/index.js";
import claudeCode from "../../src/harnesses/adapters/claude-code/index.js";

let tmp: string;

function ctxFor(root: string): MaterializeContext {
  return {
    agnosRoot: root,
    projectRoot: root,
    storeDir: path.join(root, "store"),
    configPath: path.join(root, "agnos.json"),
    logger: createLogger({ quiet: true }),
    fetcher: {} as never,
    linker: {} as never,
    dryRun: false,
    indent: "",
    harnessId: "test",
  };
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-cleanup-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("cleanupHarness (claims-based)", () => {
  it("deletes the removed agent's owned paths but keeps paths a remaining agent claims", async () => {
    const ctx = ctxFor(tmp);
    const ownedOnly = path.join(tmp, "owned.txt");
    const shared = path.join(tmp, "shared.txt");
    await fs.writeFile(ownedOnly, "x");
    await fs.writeFile(shared, "y");

    const removed: HarnessAdapter = {
      id: "a",
      displayName: "A",
      claims: () => [ownedOnly, shared],
    };
    const remaining: HarnessAdapter = { id: "b", displayName: "B", claims: () => [shared] };

    await cleanupHarness(removed, [remaining], ctx);

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

    await cleanupHarness(claudeCode, [], ctx);

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
    ).toBe(true);
  });
});

describe("renderHarness", () => {
  it("drives the adapter's slices (mcp written from config)", async () => {
    const ctx = ctxFor(tmp);
    const config: AgnosConfig = {
      schemaVersion: 1,
      harness: ["claude-code"],
      mcp: { servers: [{ name: "fs", command: "pnpx" }] },
    };
    await renderHarness(claudeCode, config, ctx);
    const written = JSON.parse(await fs.readFile(path.join(tmp, ".mcp.json"), "utf8"));
    expect(written.mcpServers.fs.command).toBe("pnpx");
  });

  it("resolves declared mcp env keys from .env.local", async () => {
    const ctx = ctxFor(tmp);
    await fs.writeFile(path.join(tmp, ".env.local"), "TOKEN=secret\nFROM=team@example.com\n");
    const config: AgnosConfig = {
      schemaVersion: 1,
      harness: ["claude-code"],
      mcp: { servers: [{ name: "fs", command: "pnpx", env: ["TOKEN", "FROM"] }] },
    };
    await renderHarness(claudeCode, config, ctx);
    const written = JSON.parse(await fs.readFile(path.join(tmp, ".mcp.json"), "utf8"));
    expect(written.mcpServers.fs.env).toEqual({ TOKEN: "secret", FROM: "team@example.com" });
  });

  it("does not write mcp config when declared env keys are missing", async () => {
    const warnings: string[] = [];
    const ctx = {
      ...ctxFor(tmp),
      logger: { ...createLogger({ quiet: true }), warn: (m) => warnings.push(String(m)) },
    };
    const config: AgnosConfig = {
      schemaVersion: 1,
      harness: ["claude-code"],
      mcp: { servers: [{ name: "fs", command: "pnpx", env: ["TOKEN"] }] },
    };
    await renderHarness(claudeCode, config, ctx);
    await expect(fs.access(path.join(tmp, ".mcp.json"))).rejects.toThrow();
    expect(warnings.some((w) => w.includes("mcp env file") && w.includes(".env.local"))).toBe(true);
  });
});
