import { describe, it, expect, beforeEach } from "vitest";
import path from "node:path";
import os from "node:os";
import {
  activeAgents,
  dispatchMcpAdded,
  dispatchRulesMoved,
  dispatchSkillAdded,
} from "../src/events.js";
import type { AgentPlugin, AgnosConfig, ResolveContext } from "../src/types/public.js";
import { createLogger } from "../src/logger.js";
import type { PluginRegistry, RegisteredAgent } from "../src/plugin-loader.js";

function stubCtx(): ResolveContext {
  const root = os.tmpdir();
  return {
    projectRoot: root,
    configPath: path.join(root, "agnos.json"),
    statePath: path.join(root, ".agnos", "state.json"),
    agnosRoot: path.join(root, ".agnos"),
    cacheDir: path.join(root, ".agnos", "cache"),
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

function registryWith(...plugins: AgentPlugin[]): PluginRegistry {
  const agents = new Map<string, RegisteredAgent>();
  const agentsByPackage = new Map<string, RegisteredAgent>();
  for (const p of plugins) {
    const reg: RegisteredAgent = { plugin: p, packageName: `@test/${p.id}`, source: "project" };
    agents.set(p.id, reg);
    agentsByPackage.set(reg.packageName, reg);
  }
  return { agents, agentsByPackage, domains: new Map(), collisions: [] };
}

describe("events dispatch", () => {
  let ctx: ResolveContext;

  beforeEach(() => {
    ctx = stubCtx();
  });

  it("fires only the handlers that are defined", async () => {
    const calls: string[] = [];
    const a: AgentPlugin = {
      id: "a",
      displayName: "A",
      handles: {
        skills: {
          async onAdded(item) {
            calls.push(`a:skills.onAdded:${item.name}`);
          },
        },
        mcp: {
          async onAdded(item) {
            calls.push(`a:mcp.onAdded:${item.name}`);
          },
        },
      },
    };
    const b: AgentPlugin = {
      id: "b",
      displayName: "B",
      handles: {
        // doesn't handle skills
        mcp: {
          async onAdded(item) {
            calls.push(`b:mcp.onAdded:${item.name}`);
          },
        },
      },
    };

    const emptyConfig: AgnosConfig = { skills: [], mcp: [] };
    await dispatchSkillAdded({ name: "pdf", absolutePath: "/x/pdf" }, [a, b], emptyConfig, ctx);
    await dispatchMcpAdded({ name: "github", command: "npx" }, [a, b], emptyConfig, ctx);

    expect(calls).toEqual(["a:skills.onAdded:pdf", "a:mcp.onAdded:github", "b:mcp.onAdded:github"]);
  });

  it("dispatchRulesMoved passes both from and to", async () => {
    const seen: { from: string; to: string }[] = [];
    const a: AgentPlugin = {
      id: "a",
      displayName: "A",
      handles: {
        rules: {
          async onMoved(from, to) {
            seen.push({ from: from.relativeSource, to: to.relativeSource });
          },
        },
      },
    };
    await dispatchRulesMoved(
      { absolutePath: "/x/old.md", relativeSource: "./old.md" },
      { absolutePath: "/x/new.md", relativeSource: "./new.md" },
      [a],
      {},
      ctx,
    );
    expect(seen).toEqual([{ from: "./old.md", to: "./new.md" }]);
  });

  it("falls back to onInitialize when per-event handler is missing", async () => {
    const calls: string[] = [];
    const a: AgentPlugin = {
      id: "a",
      displayName: "A",
      handles: {
        mcp: {
          async onInitialize(state) {
            calls.push(`a:mcp.onInitialize:n=${(state as unknown[]).length}`);
          },
        },
      },
    };
    const config: AgnosConfig = {
      mcp: [
        { name: "github", command: "npx" },
        { name: "postgres", command: "npx" },
      ],
    };
    await dispatchMcpAdded({ name: "postgres", command: "npx" }, [a], config, ctx);
    expect(calls).toEqual(["a:mcp.onInitialize:n=2"]);
  });

  it("dry-run skips invocation but logs", async () => {
    const calls: string[] = [];
    const messages: string[] = [];
    const logger = { ...createLogger(), info: (m: string) => messages.push(m) } as ReturnType<
      typeof createLogger
    >;
    const dryCtx: ResolveContext = { ...ctx, logger, dryRun: true };
    const a: AgentPlugin = {
      id: "a",
      displayName: "A",
      handles: {
        skills: {
          async onAdded() {
            calls.push("a:skills.onAdded");
          },
        },
      },
    };
    await dispatchSkillAdded({ name: "pdf", absolutePath: "/x/pdf" }, [a], { skills: [] }, dryCtx);
    expect(calls).toEqual([]);
    expect(messages.some((m) => m.includes("would:"))).toBe(true);
  });

  it("activeAgents resolves declared agent refs and warns on missing plugins", () => {
    const a: AgentPlugin = { id: "a", displayName: "A" };
    const registry = registryWith(a);
    const config: AgnosConfig = { agents: ["a", "ghost"] };
    const out = activeAgents(config, registry, ctx);
    expect(out.map((p) => p.id)).toEqual(["a"]);
  });
});
