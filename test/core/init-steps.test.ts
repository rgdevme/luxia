import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { Logger, ResolveContext } from "../../src/core/index.js";
import { readConfigOrDefault, runDomainInitSteps } from "../../src/core/index.js";
import { agentsDomain } from "../../src/domains/agents/index.js";

let tmp: string;
let logs: string[];

const recordingLogger = (): Logger => ({
  info: (m) => logs.push(`info: ${m}`),
  warn: (m) => logs.push(`warn: ${m}`),
  error: (m) => logs.push(`error: ${m}`),
  debug: (m) => logs.push(`debug: ${m}`),
  success: (m) => logs.push(`success: ${m}`),
});

const ctxFor = (): ResolveContext => ({
  agnosRoot: tmp,
  projectRoot: tmp,
  cacheDir: path.join(tmp, ".agnos", "cache"),
  configPath: path.join(tmp, "agnos.json"),
  statePath: path.join(tmp, ".agnos", "state.json"),
  logger: recordingLogger(),
  fetcher: {} as never,
  linker: {} as never,
  dryRun: false,
});

const writeCfg = (c: object) =>
  fs.writeFile(path.join(tmp, "agnos.json"), JSON.stringify({ schemaVersion: 1, ...c }));
const readCfg = () => readConfigOrDefault(path.join(tmp, "agnos.json"));

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-init-"));
  logs = [];
  await writeCfg({});
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("agents init multiselect step", () => {
  it("writes the curated default agent set non-interactively (-y)", async () => {
    await runDomainInitSteps(agentsDomain, ctxFor(), { yes: true, dryRun: false });
    expect((await readCfg()).agents).toEqual(["claude-code", "codex"]);
  });

  it("preserves an existing selection rather than reapplying the default", async () => {
    await writeCfg({ agents: ["codex"] });
    await runDomainInitSteps(agentsDomain, ctxFor(), { yes: true, dryRun: false });
    expect((await readCfg()).agents).toEqual(["codex"]);
  });

  it("under --dry logs the array value and writes nothing", async () => {
    const ctx = ctxFor();
    await runDomainInitSteps(agentsDomain, ctx, { yes: false, dryRun: true });
    expect(logs.some((l) => l.includes('agents.select = ["claude-code","codex"]'))).toBe(true);
    expect((await readCfg()).agents).toBeUndefined();
  });
});
