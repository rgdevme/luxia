import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { z } from "zod";
import { reinstate } from "../src/orchestrator.js";
import { writeConfig } from "../src/config.js";
import { readState } from "../src/state.js";
import { resetSymlinkDecisionCache } from "../src/context.js";
import { createLogger } from "../src/logger.js";
import type {
  AgentPlugin,
  AgnosConfig,
  DomainPlugin,
  ResolveContext,
} from "../src/types/public.js";
import type { PluginRegistry, RegisteredAgent, RegisteredDomain } from "../src/plugin-loader.js";

function spyDomain(name: string, priority: number, calls: string[]): DomainPlugin {
  return {
    name,
    priority,
    declarationSchema: z.any(),
    async onInitialize() {
      calls.push(`domain:${name}.onInitialize`);
    },
  };
}

function spyAgent(id: string, calls: string[]): AgentPlugin {
  return {
    id,
    displayName: id,
    async onInstalled() {
      calls.push(`${id}.onInstalled`);
    },
    handles: {
      rules: {
        async onInitialize() {
          calls.push(`${id}.rules.onInitialize`);
        },
      },
      mcp: {
        async onInitialize() {
          calls.push(`${id}.mcp.onInitialize`);
        },
      },
      skills: {
        async onInitialize() {
          calls.push(`${id}.skills.onInitialize`);
        },
      },
    },
  };
}

function registry(domains: DomainPlugin[], agents: AgentPlugin[]): PluginRegistry {
  const ds = new Map<string, RegisteredDomain>();
  for (const d of domains)
    ds.set(d.name, { plugin: d, packageName: `@test/domain-${d.name}`, source: "project" });
  const as = new Map<string, RegisteredAgent>();
  const aByPkg = new Map<string, RegisteredAgent>();
  for (const a of agents) {
    const reg: RegisteredAgent = {
      plugin: a,
      packageName: `@test/agent-${a.id}`,
      source: "project",
    };
    as.set(a.id, reg);
    aByPkg.set(reg.packageName, reg);
  }
  return { agents: as, agentsByPackage: aByPkg, domains: ds, collisions: [] };
}

function ctxFor(projectRoot: string): ResolveContext {
  return {
    projectRoot,
    configPath: path.join(projectRoot, "agnos.json"),
    statePath: path.join(projectRoot, ".agnos", "state.json"),
    agnosRoot: path.join(projectRoot, ".agnos"),
    cacheDir: path.join(projectRoot, ".agnos", "cache"),
    logger: createLogger({ quiet: true }),
    fetcher: { fetch: async () => ({ path: "" }) },
    linker: {
      canSymlinkFiles: async () => true,
      canSymlinkDirs: async () => true,
      link: async () => ({ kind: "symlink" }),
      unlink: async () => {},
    },
  };
}

describe("reinstate end-to-end", () => {
  let dir: string;

  beforeEach(async () => {
    resetSymlinkDecisionCache();
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-reinstate-"));
    await fs.mkdir(path.join(dir, ".agnos"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("first run: fires domain init + onInstalled + per-domain init for each agent in priority order", async () => {
    const calls: string[] = [];
    const config: AgnosConfig = {
      agents: ["a", "b"],
      rules: { source: "./AGENTS.md" },
      mcp: [],
      skills: {},
    };
    await writeConfig(path.join(dir, "agnos.json"), config);
    const r = registry(
      [spyDomain("rules", 10, calls), spyDomain("mcp", 20, calls), spyDomain("skills", 30, calls)],
      [spyAgent("a", calls), spyAgent("b", calls)],
    );
    const ctx = ctxFor(dir);
    const result = await reinstate(config, r, ctx, { interactive: false });
    expect(result.ok).toBe(true);

    // onInstalled fires once per agent BEFORE the domain-outer pipeline begins.
    expect(calls.slice(0, 2)).toEqual(["a.onInstalled", "b.onInstalled"]);
    // Then for each domain in priority order: domain.onInitialize, then per-agent fan-out.
    expect(calls.slice(2)).toEqual([
      "domain:rules.onInitialize",
      "a.rules.onInitialize",
      "b.rules.onInitialize",
      "domain:mcp.onInitialize",
      "a.mcp.onInitialize",
      "b.mcp.onInitialize",
      "domain:skills.onInitialize",
      "a.skills.onInitialize",
      "b.skills.onInitialize",
    ]);

    const state = await readState(ctx.statePath);
    expect(state.installedAgents.sort()).toEqual(["a", "b"]);
    expect(state.initializedDomains.sort()).toEqual(["mcp", "rules", "skills"]);
  });

  it("second run: onInstalled and domain.onInitialize don't re-fire; per-agent init does", async () => {
    const calls1: string[] = [];
    const config: AgnosConfig = {
      agents: ["a"],
      rules: { source: "./AGENTS.md" },
      mcp: [],
      skills: {},
    };
    await writeConfig(path.join(dir, "agnos.json"), config);
    const r1 = registry([spyDomain("rules", 10, calls1)], [spyAgent("a", calls1)]);
    await reinstate(config, r1, ctxFor(dir), { interactive: false });

    // second run — fresh spies
    const calls2: string[] = [];
    const r2 = registry([spyDomain("rules", 10, calls2)], [spyAgent("a", calls2)]);
    await reinstate(config, r2, ctxFor(dir), { interactive: false });

    expect(calls2).toEqual(["a.rules.onInitialize"]);
  });
});
