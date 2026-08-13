import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import { createLogger } from "../../src/core/logger.js";
import { runOne } from "../../src/core/run.js";
import type { PluginRegistry } from "../../src/core/plugin-loader.js";
import type { Domain, RunContext } from "../../src/core/types/public.js";

const OPTIONS = { dry: false, once: true, quiet: true, interactive: false };

function buildRegistry(domain: Domain): PluginRegistry {
  return {
    agents: new Map(),
    agentsByPackage: new Map(),
    domains: new Map([[domain.id, { domain, packageName: "test" }]]),
    collisions: [],
  };
}

function buildContext(cleanup: () => Promise<void>): RunContext {
  const root = path.resolve("test-project");
  return {
    agnosRoot: path.join(root, ".agnos"),
    projectRoot: root,
    storeDir: path.join(root, "store"),
    configPath: path.join(root, "agnos.json"),
    statePath: path.join(root, ".agnos", "state.json"),
    logger: createLogger({ quiet: true }),
    fetcher: { fetch: vi.fn(), cleanup } as never,
    linker: {} as never,
    flags: { dry: false, once: true, quiet: true, help: false, init: false, yes: true },
  };
}

describe("domain repository staging cleanup", () => {
  it("cleans transient checkouts when a domain run fails", async () => {
    const cleanup = vi.fn(async () => {});
    const failure = new Error("domain failed");
    const domain: Domain = {
      id: "test",
      description: "test",
      kind: "writer",
      priority: 1,
      run: async () => {
        throw failure;
      },
    };

    await expect(
      runOne(buildRegistry(domain), domain.id, OPTIONS, buildContext(cleanup)),
    ).rejects.toBe(failure);
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
