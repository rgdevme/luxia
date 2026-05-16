import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { z } from "zod";
import {
  buildAgentDomainStates,
  cleanupAgent,
  initializeAgentsInterleaved,
  materializeAgent,
  orderedDomains,
} from "../src/orchestrator.js";
import type { AgentPlugin, AgnosConfig, DomainPlugin, ResolveContext } from "../src/types/public.js";
import { createLogger } from "../src/logger.js";
import type {
  PluginRegistry,
  RegisteredAgent,
  RegisteredDomain,
} from "../src/plugin-loader.js";

function noopDomain(name: string, priority: number): DomainPlugin {
  return {
    name,
    priority,
    declarationSchema: z.any(),
  };
}

function spyDomain(name: string, priority: number, calls: string[]): DomainPlugin {
  return {
    name,
    priority,
    declarationSchema: z.any(),
    async onInitialize() {
      calls.push(`domain:${name}`);
    },
  };
}

function registry(domains: DomainPlugin[], agents: AgentPlugin[] = []): PluginRegistry {
  const ds = new Map<string, RegisteredDomain>();
  for (const d of domains) ds.set(d.name, { plugin: d, packageName: `@test/domain-${d.name}` });
  const as = new Map<string, RegisteredAgent>();
  const aByPkg = new Map<string, RegisteredAgent>();
  for (const a of agents) {
    const reg: RegisteredAgent = { plugin: a, packageName: `@test/agent-${a.id}` };
    as.set(a.id, reg);
    aByPkg.set(reg.packageName, reg);
  }
  return { agents: as, agentsByPackage: aByPkg, domains: ds, collisions: [] };
}

function stubCtx(projectRoot: string): ResolveContext {
  return {
    projectRoot,
    configPath: path.join(projectRoot, "agnos.json"),
    statePath: path.join(projectRoot, ".agnos", "state.json"),
    agnosRoot: path.join(projectRoot, ".agnos"),
    cacheDir: path.join(projectRoot, ".agnos", "cache"),
    logger: createLogger(),
    fetcher: { resolve: async () => ({ path: "" }) },
    linker: {
      canSymlinkFiles: async () => true,
      canSymlinkDirs: async () => true,
      link: async () => ({ kind: "symlink" }),
      unlink: async () => {},
    },
  };
}

describe("orderedDomains", () => {
  it("sorts by ascending priority", () => {
    const r = registry([
      noopDomain("docs", 40),
      noopDomain("rules", 10),
      noopDomain("skills", 30),
      noopDomain("mcp", 20),
    ]);
    expect(orderedDomains(r).map((d) => d.plugin.name)).toEqual(["rules", "mcp", "skills", "docs"]);
  });

  it("treats missing priority as infinite (runs last)", () => {
    const r = registry([
      { name: "alpha", priority: Number.NaN as unknown as number, declarationSchema: z.any() },
      noopDomain("rules", 10),
    ]);
    expect(orderedDomains(r).map((d) => d.plugin.name)).toEqual(["rules", "alpha"]);
  });
});

describe("materializeAgent + cleanupAgent ordering", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-orch-"));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("fires per-domain onInitialize in priority order, then cleanup in reverse", async () => {
    const calls: string[] = [];
    const agent: AgentPlugin = {
      id: "spy",
      displayName: "Spy",
      handles: {
        rules: {
          async onInitialize() {
            calls.push("init:rules");
          },
          async onCleanup() {
            calls.push("cleanup:rules");
          },
        },
        mcp: {
          async onInitialize() {
            calls.push("init:mcp");
          },
          async onCleanup() {
            calls.push("cleanup:mcp");
          },
        },
        skills: {
          async onInitialize() {
            calls.push("init:skills");
          },
          async onCleanup() {
            calls.push("cleanup:skills");
          },
        },
      },
    };
    const r = registry(
      [noopDomain("rules", 10), noopDomain("mcp", 20), noopDomain("skills", 30)],
      [agent],
    );
    const ctx = stubCtx(dir);
    const config: AgnosConfig = { agents: ["spy"], rules: { source: "./AGENTS.md" }, mcp: [], skills: [] };
    await materializeAgent(agent, config, r, ctx);
    await cleanupAgent(agent, r, ctx);
    expect(calls).toEqual([
      "init:rules",
      "init:mcp",
      "init:skills",
      "cleanup:skills",
      "cleanup:mcp",
      "cleanup:rules",
    ]);
  });

  it("interleaves domain-then-agents across multiple agents (domain-outer order)", async () => {
    const calls: string[] = [];
    const makeAgent = (id: string): AgentPlugin => ({
      id,
      displayName: id,
      handles: {
        rules: {
          async onInitialize() {
            calls.push(`${id}:rules`);
          },
        },
        mcp: {
          async onInitialize() {
            calls.push(`${id}:mcp`);
          },
        },
        skills: {
          async onInitialize() {
            calls.push(`${id}:skills`);
          },
        },
      },
    });
    const a = makeAgent("a");
    const b = makeAgent("b");
    const r = registry(
      [
        spyDomain("rules", 10, calls),
        spyDomain("mcp", 20, calls),
        spyDomain("skills", 30, calls),
      ],
      [a, b],
    );
    const ctx = stubCtx(dir);
    const config: AgnosConfig = { agents: ["a", "b"], rules: { source: "./AGENTS.md" }, mcp: [], skills: [] };
    await initializeAgentsInterleaved([a, b], config, r, ctx);
    expect(calls).toEqual([
      "domain:rules",
      "a:rules",
      "b:rules",
      "domain:mcp",
      "a:mcp",
      "b:mcp",
      "domain:skills",
      "a:skills",
      "b:skills",
    ]);
  });

  it("domain.onInitialize fires only once per project (state-gated)", async () => {
    const calls: string[] = [];
    const a: AgentPlugin = {
      id: "a",
      displayName: "A",
      handles: {
        rules: {
          async onInitialize() {
            calls.push("a:rules");
          },
        },
      },
    };
    const r = registry([spyDomain("rules", 10, calls)], [a]);
    const ctx = stubCtx(dir);
    const config: AgnosConfig = { agents: ["a"], rules: { source: "./AGENTS.md" } };
    await initializeAgentsInterleaved([a], config, r, ctx);
    await initializeAgentsInterleaved([a], config, r, ctx);
    // domain hook fires once, per-agent handler fires twice
    expect(calls).toEqual(["domain:rules", "a:rules", "a:rules"]);
  });

  it("skips domains the agent doesn't handle", async () => {
    const calls: string[] = [];
    const agent: AgentPlugin = {
      id: "partial",
      displayName: "Partial",
      handles: {
        mcp: {
          async onInitialize() {
            calls.push("init:mcp");
          },
        },
      },
    };
    const r = registry(
      [noopDomain("rules", 10), noopDomain("mcp", 20), noopDomain("skills", 30)],
      [agent],
    );
    const ctx = stubCtx(dir);
    const config: AgnosConfig = { agents: ["partial"], rules: { source: "./AGENTS.md" } };
    await materializeAgent(agent, config, r, ctx);
    expect(calls).toEqual(["init:mcp"]);
  });
});

describe("buildAgentDomainStates", () => {
  it("returns per-domain state slices keyed by domain name", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-state-build-"));
    try {
      const ctx = stubCtx(dir);
      const config: AgnosConfig = {
        rules: { source: "./AGENTS.md" },
        mcp: [{ name: "github", command: "npx" }],
        skills: [{ name: "pdf", source: "file:./pdf" }],
      };
      const state = await buildAgentDomainStates(config, ctx);
      expect(state["rules"]).toEqual({
        absolutePath: path.resolve(dir, "./AGENTS.md"),
        relativeSource: "./AGENTS.md",
      });
      expect(state["mcp"]).toEqual([{ name: "github", command: "npx" }]);
      expect((state["skills"] as Array<{ name: string }>)[0]?.name).toBe("pdf");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("rules slice is undefined when no rules in config", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-state-build-"));
    try {
      const ctx = stubCtx(dir);
      const state = await buildAgentDomainStates({}, ctx);
      expect(state["rules"]).toBeUndefined();
      expect(state["mcp"]).toEqual([]);
      expect(state["skills"]).toEqual([]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
