import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { CommandContext, Domain } from "../../src/core/index.js";
import { createLogger, createRepoFetcher, readConfigOrDefault } from "../../src/core/index.js";
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
  // Real fetcher: for `file:` (local) sources it just returns the absolute path,
  // so skills `add` discovery works without any network access.
  fetcher: createRepoFetcher({ projectRoot: tmp, cacheDir: path.join(tmp, ".agnos", "cache") }),
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
  // Build a local source dir with a few skills (each a dir containing SKILL.md).
  const makeSkillSource = async (rel: string, names: string[]) => {
    for (const n of names) {
      const dir = path.join(tmp, rel, "skills", n);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "SKILL.md"), `# ${n} skill\n`);
    }
  };

  it("add with --skills filter writes only the named skills, stored by skill name", async () => {
    await makeSkillSource("src-skills", ["pdf", "lint"]);
    await run(skillsDomain, "add", ["./src-skills"], { provider: "file", skills: "pdf" });
    expect((await readCfg()).skills?.sources).toEqual({
      pdf: "file:./src-skills/skills/pdf",
    });
  });

  it("add under -y installs every discovered skill", async () => {
    await makeSkillSource("src-skills", ["pdf", "lint"]);
    await run(skillsDomain, "add", ["./src-skills"], { provider: "file" });
    expect((await readCfg()).skills?.sources).toEqual({
      pdf: "file:./src-skills/skills/pdf",
      lint: "file:./src-skills/skills/lint",
    });
  });

  it("add across multiple sources aggregates skills under their own names", async () => {
    await makeSkillSource("one", ["pdf"]);
    await makeSkillSource("two", ["lint"]);
    await run(skillsDomain, "add", ["./one", "./two"], { provider: "file" });
    expect((await readCfg()).skills?.sources).toEqual({
      pdf: "file:./one/skills/pdf",
      lint: "file:./two/skills/lint",
    });
  });

  it("add -y resolves a same-name collision to the last-declared source", async () => {
    await makeSkillSource("one", ["pdf"]);
    await makeSkillSource("two", ["pdf"]);
    // Both sources expose a "pdf"; -y picks the last declared (./two) for that name.
    await run(skillsDomain, "add", ["./one", "./two"], { provider: "file" });
    expect((await readCfg()).skills?.sources).toEqual({
      pdf: "file:./two/skills/pdf",
    });
  });

  it("add --skills resolves a same-name collision to the last-declared source", async () => {
    await makeSkillSource("one", ["pdf"]);
    await makeSkillSource("two", ["pdf"]);
    await run(skillsDomain, "add", ["./one", "./two"], { provider: "file", skills: "pdf" });
    expect((await readCfg()).skills?.sources).toEqual({
      pdf: "file:./two/skills/pdf",
    });
  });

  it("add with no filter + non-interactive errors instead of prompting", async () => {
    await makeSkillSource("src-skills", ["pdf", "lint"]);
    await expect(
      run(skillsDomain, "add", ["./src-skills"], { provider: "file", yes: false }),
    ).rejects.toThrow(/skills|terminal/i);
  });

  it("add with an unknown --skills name throws and lists what's available", async () => {
    await makeSkillSource("src-skills", ["pdf", "lint"]);
    await expect(
      run(skillsDomain, "add", ["./src-skills"], { provider: "file", skills: "ghost" }),
    ).rejects.toThrow(/not found.*pdf|not found.*lint/);
  });

  it("add of an already-declared skill overwrites it under --skills", async () => {
    await makeSkillSource("src-skills", ["pdf"]);
    await writeCfg({ skills: { sources: { pdf: "file:./stale/skills/pdf" } } });
    await run(skillsDomain, "add", ["./src-skills"], { provider: "file", skills: "pdf" });
    expect((await readCfg()).skills?.sources["pdf"]).toBe("file:./src-skills/skills/pdf");
  });

  it("add reports a clear error when the source has no skills", async () => {
    await fs.mkdir(path.join(tmp, "empty"), { recursive: true });
    await expect(run(skillsDomain, "add", ["./empty"], { provider: "file" })).rejects.toThrow(
      /no skills found/,
    );
  });

  it("remove deletes multiple named skills; no-name + non-interactive errors", async () => {
    await writeCfg({
      skills: { sources: { a: "github:o/r/skills/a", b: "github:o/r/skills/b" } },
    });
    await run(skillsDomain, "remove", ["a", "b"]);
    expect((await readCfg()).skills?.sources ?? {}).toEqual({});
    await writeCfg({ skills: { sources: { c: "github:o/r/skills/c" } } });
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
