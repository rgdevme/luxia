import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { CommandContext, Domain } from "../../src/core/index.js";
import { createLogger, readConfigOrDefault } from "../../src/core/index.js";
import mcpDomain from "../../src/domains/mcp/index.js";
import hooksDomain from "../../src/domains/hooks/index.js";
import skillsDomain from "../../src/domains/skills/index.js";
import { agentsDomain } from "../../src/domains/agents/index.js";

let tmp: string;

const ctxFor = (args: string[], extra: Record<string, unknown> = {}): CommandContext => ({
  agnosRoot: tmp,
  projectRoot: tmp,
  cacheDir: path.join(tmp, ".agnos", "cache"),
  configPath: path.join(tmp, "agnos.json"),
  statePath: path.join(tmp, ".agnos", "state.json"),
  logger: createLogger({ quiet: true }),
  fetcher: {} as never,
  linker: {} as never,
  dryRun: false,
  args,
  flags: { dry: false, once: true, quiet: true, help: false, init: false, yes: true, ...extra },
});

const writeCfg = (c: object) =>
  fs.writeFile(path.join(tmp, "agnos.json"), JSON.stringify({ schemaVersion: 1, ...c }));
const readCfg = () => readConfigOrDefault(path.join(tmp, "agnos.json"));
const run = (d: Domain, name: string, args: string[], extra?: Record<string, unknown>) =>
  d.commands![name]!.run(ctxFor(args, extra));

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-cmd-"));
  await writeCfg({});
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("mcp subcommands", () => {
  it("add appends a server; a duplicate add throws", async () => {
    await run(mcpDomain, "add", ["gh", "npx", "-y", "s"]);
    expect((await readCfg()).mcp).toEqual([
      { name: "gh", command: "npx", args: ["-y", "s"], transport: "stdio" },
    ]);
    await expect(run(mcpDomain, "add", ["gh", "x"])).rejects.toThrow(/already exists/);
  });

  it("remove drops named servers; missing throws; no-arg is guarded", async () => {
    await run(mcpDomain, "add", ["gh", "npx"]);
    await run(mcpDomain, "add", ["fs", "npx"]);
    await expect(run(mcpDomain, "remove", ["nope"])).rejects.toThrow(/not found/);
    // no names + non-interactive (yes flag / no TTY) → guarded, doesn't prompt
    await expect(run(mcpDomain, "remove", [])).rejects.toThrow(/specify server/i);
    await run(mcpDomain, "remove", ["gh", "fs"]);
    expect((await readCfg()).mcp).toEqual([]);
  });

  it("migrate imports servers from an active agent's native config", async () => {
    await writeCfg({ agents: ["claude-code"] });
    await fs.writeFile(
      path.join(tmp, ".mcp.json"),
      JSON.stringify({ mcpServers: { gh: { command: "npx", args: ["s"] } } }),
    );
    await run(mcpDomain, "migrate", [], { missing: true });
    expect((await readCfg()).mcp?.map((m) => m.name)).toEqual(["gh"]);
  });
});

describe("hooks subcommands", () => {
  it("add appends a hook; an unknown event throws; remove drops it", async () => {
    await run(hooksDomain, "add", ["PreToolUse", "echo hi", "git"]);
    expect((await readCfg()).hooks).toHaveLength(1);
    await expect(run(hooksDomain, "add", ["Nope", "x"])).rejects.toThrow(/unknown hook event/);
    await run(hooksDomain, "remove", ["PreToolUse", "echo hi", "git"]);
    expect((await readCfg()).hooks).toEqual([]);
  });

  it("remove with no args in non-interactive mode is guarded (no prompt)", async () => {
    await run(hooksDomain, "add", ["Stop", "echo bye"]);
    await expect(run(hooksDomain, "remove", [])).rejects.toThrow(/terminal|specify/i);
  });
});

describe("skills subcommands", () => {
  it("add derives the name from the ref; bad explicit name and non-concrete refs throw", async () => {
    await run(skillsDomain, "add", ["github:o/r/skills/pdf"]); // name derived: "pdf"
    expect((await readCfg()).skills?.sources).toEqual({ pdf: "github:o/r/skills/pdf" });
    // bare owner/repo (defaults to github) is canonicalized + name derived from the path
    await run(skillsDomain, "add", ["o/r/skills/lint"]);
    expect((await readCfg()).skills?.sources["lint"]).toBe("github:o/r/skills/lint");
    // explicit invalid name → clear error (not a zod dump)
    await expect(run(skillsDomain, "add", ["github:o/r/skills/x", "Bad Name"])).rejects.toThrow(
      /skill name/,
    );
    // non-concrete git ref (no in-repo path) → clear parse error
    await expect(run(skillsDomain, "add", ["o/r"])).rejects.toThrow(/in-repo path/);
    await run(skillsDomain, "remove", ["pdf"]);
    expect((await readCfg()).skills?.sources["pdf"]).toBeUndefined();
  });

  it("remove deletes multiple named skills; no-name + non-interactive errors", async () => {
    await run(skillsDomain, "add", ["github:o/r/skills/a"]);
    await run(skillsDomain, "add", ["github:o/r/skills/b"]);
    await run(skillsDomain, "remove", ["a", "b"]);
    expect((await readCfg()).skills?.sources ?? {}).toEqual({});
    await run(skillsDomain, "add", ["github:o/r/skills/c"]);
    // no names + non-interactive (yes flag) → errors instead of hanging on a prompt
    await expect(run(skillsDomain, "remove", [])).rejects.toThrow(/specify skill/i);
  });
});

describe("agents subcommands", () => {
  it("add enables a known agent; unknown throws; remove disables it", async () => {
    await run(agentsDomain, "add", ["claude-code"]);
    expect((await readCfg()).agents).toEqual(["claude-code"]);
    await expect(run(agentsDomain, "add", ["zed"])).rejects.toThrow(/unknown agent/);
    await run(agentsDomain, "remove", ["claude-code"]);
    expect((await readCfg()).agents).toEqual([]);
  });
});
