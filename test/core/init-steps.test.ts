import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runDomainInitSteps, runAllDomainInitSteps } from "../../src/core/commands/init-steps.js";
import type {
  DomainPlugin,
  InitStep,
  Logger,
  ResolveContext,
} from "../../src/core/types/public.js";
import type { PluginRegistry, RegisteredDomain } from "../../src/core/plugin-loader.js";

interface CapturedLog {
  level: "info" | "warn" | "error" | "debug" | "success";
  msg: string;
}

function captureLogger(): { logger: Logger; logs: CapturedLog[] } {
  const logs: CapturedLog[] = [];
  const make = (level: CapturedLog["level"]) => (msg: string) => {
    logs.push({ level, msg });
  };
  return {
    logs,
    logger: {
      info: make("info"),
      warn: make("warn"),
      error: make("error"),
      debug: make("debug"),
      success: make("success"),
    },
  };
}

async function makeCtx(logger: Logger): Promise<ResolveContext> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-initsteps-"));
  return {
    projectRoot: tmp,
    configPath: path.join(tmp, "agnos.json"),
    statePath: path.join(tmp, ".agnos", "state.json"),
    agnosRoot: path.join(tmp, ".agnos"),
    cacheDir: path.join(tmp, ".agnos", "cache"),
    logger,
    fetcher: { fetch: async () => ({ path: tmp }) },
    linker: {
      canSymlinkFiles: async () => true,
      canSymlinkDirs: async () => true,
      link: async () => ({ kind: "symlink" }),
      unlink: async () => {},
    },
    dryRun: false,
  };
}

function makeDomain(name: string, priority: number, initSteps: InitStep[]): RegisteredDomain {
  const plugin: DomainPlugin = {
    name,
    priority,
    declarationSchema: { parse: (x: unknown) => x } as unknown as DomainPlugin["declarationSchema"],
    initSteps,
  };
  return { plugin, packageName: `@test/${name}`, source: "project" };
}

describe("runDomainInitSteps", () => {
  let logger: Logger;
  let logs: CapturedLog[];
  let ctx: ResolveContext;

  beforeEach(async () => {
    const cap = captureLogger();
    logger = cap.logger;
    logs = cap.logs;
    ctx = await makeCtx(logger);
  });

  it("with yes:true uses defaults and calls callbacks without prompting", async () => {
    const calls: unknown[] = [];
    const plugin: DomainPlugin = {
      name: "test",
      priority: 1,
      declarationSchema: {
        parse: (x: unknown) => x,
      } as unknown as DomainPlugin["declarationSchema"],
      initSteps: [
        {
          id: "a",
          type: "text",
          message: "?",
          default: "hello",
          async callback(v) {
            calls.push(v);
          },
        },
        {
          id: "b",
          type: "boolean",
          message: "?",
          default: true,
          async callback(v) {
            calls.push(v);
          },
        },
        {
          id: "c",
          type: "select",
          message: "?",
          choices: [
            { name: "X", value: "x" },
            { name: "Y", value: "y" },
          ],
          default: "y",
          async callback(v) {
            calls.push(v);
          },
        },
      ],
    };

    await runDomainInitSteps(plugin, ctx, { yes: true, dryRun: false });
    expect(calls).toEqual(["hello", true, "y"]);
  });

  it("with dryRun:true logs the planned value and skips the callback", async () => {
    let called = false;
    const plugin: DomainPlugin = {
      name: "dr",
      priority: 1,
      declarationSchema: {
        parse: (x: unknown) => x,
      } as unknown as DomainPlugin["declarationSchema"],
      initSteps: [
        {
          id: "key",
          type: "text",
          message: "?",
          default: "abc",
          async callback() {
            called = true;
          },
        },
      ],
    };
    await runDomainInitSteps(plugin, ctx, { yes: true, dryRun: true });
    expect(called).toBe(false);
    expect(logs.find((l) => l.msg.includes("would: dr.key"))).toBeTruthy();
  });

  it("a throwing callback does not abort subsequent steps", async () => {
    const seen: string[] = [];
    const plugin: DomainPlugin = {
      name: "errs",
      priority: 1,
      declarationSchema: {
        parse: (x: unknown) => x,
      } as unknown as DomainPlugin["declarationSchema"],
      initSteps: [
        {
          id: "boom",
          type: "text",
          message: "?",
          default: "1",
          async callback() {
            throw new Error("nope");
          },
        },
        {
          id: "ok",
          type: "text",
          message: "?",
          default: "2",
          async callback(v) {
            seen.push(v);
          },
        },
      ],
    };
    await runDomainInitSteps(plugin, ctx, { yes: true, dryRun: false });
    expect(seen).toEqual(["2"]);
    expect(logs.find((l) => l.level === "error" && l.msg.includes("errs.boom"))).toBeTruthy();
  });

  it("skips a step entirely when its `when` predicate returns false", async () => {
    const calls: string[] = [];
    const plugin: DomainPlugin = {
      name: "gate",
      priority: 1,
      declarationSchema: {
        parse: (x: unknown) => x,
      } as unknown as DomainPlugin["declarationSchema"],
      initSteps: [
        {
          id: "skipped",
          type: "text",
          message: "?",
          default: "no",
          when: () => false,
          async callback() {
            calls.push("skipped");
          },
        },
        {
          id: "ran",
          type: "text",
          message: "?",
          default: "yes",
          async callback() {
            calls.push("ran");
          },
        },
      ],
    };
    await runDomainInitSteps(plugin, ctx, { yes: true, dryRun: false });
    expect(calls).toEqual(["ran"]);
  });

  it("function-typed defaults are resolved with the active ctx", async () => {
    const seen: string[] = [];
    const plugin: DomainPlugin = {
      name: "fd",
      priority: 1,
      declarationSchema: {
        parse: (x: unknown) => x,
      } as unknown as DomainPlugin["declarationSchema"],
      initSteps: [
        {
          id: "dyn",
          type: "text",
          message: "?",
          default: async (c) => `from-ctx:${path.basename(c.projectRoot)}`,
          async callback(v) {
            seen.push(v);
          },
        },
      ],
    };
    await runDomainInitSteps(plugin, ctx, { yes: true, dryRun: false });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(/^from-ctx:/);
  });
});

describe("runAllDomainInitSteps", () => {
  it("runs domains in priority order and honors onlyIds", async () => {
    const order: string[] = [];
    const a = makeDomain("a", 30, [
      {
        id: "x",
        type: "text",
        message: "?",
        default: "A",
        async callback() {
          order.push("a");
        },
      },
    ]);
    const b = makeDomain("b", 10, [
      {
        id: "x",
        type: "text",
        message: "?",
        default: "B",
        async callback() {
          order.push("b");
        },
      },
    ]);
    const c = makeDomain("c", 20, [
      {
        id: "x",
        type: "text",
        message: "?",
        default: "C",
        async callback() {
          order.push("c");
        },
      },
    ]);

    const registry: PluginRegistry = {
      agents: new Map(),
      agentsByPackage: new Map(),
      domains: new Map([
        ["a", a],
        ["b", b],
        ["c", c],
      ]),
      collisions: [],
    };

    const cap = captureLogger();
    const ctx = await makeCtx(cap.logger);

    await runAllDomainInitSteps(registry, ctx, { yes: true, dryRun: false });
    expect(order).toEqual(["b", "c", "a"]);

    order.length = 0;
    await runAllDomainInitSteps(registry, ctx, { yes: true, dryRun: false }, ["a", "c"]);
    expect(order).toEqual(["c", "a"]);
  });

  it("warns about unknown ids in onlyIds", async () => {
    const a = makeDomain("a", 10, [
      {
        id: "x",
        type: "text",
        message: "?",
        default: "A",
        async callback() {},
      },
    ]);
    const registry: PluginRegistry = {
      agents: new Map(),
      agentsByPackage: new Map(),
      domains: new Map([["a", a]]),
      collisions: [],
    };
    const cap = captureLogger();
    const ctx = await makeCtx(cap.logger);
    await runAllDomainInitSteps(registry, ctx, { yes: true, dryRun: false }, ["ghost"]);
    expect(cap.logs.find((l) => l.level === "warn" && l.msg.includes('"ghost"'))).toBeTruthy();
  });
});
