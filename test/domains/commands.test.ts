import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { CommandContext, Domain, Logger } from "../../src/core/index.js";
import { createLogger, createRepoFetcher, readConfigOrDefault } from "../../src/core/index.js";
import mcpDomain from "../../src/domains/mcp/index.js";
import hooksDomain from "../../src/domains/hooks/index.js";
import skillsDomain from "../../src/domains/skills/index.js";
import { agentsDomain } from "../../src/domains/agents/index.js";

let tmp: string;

let capturedLogger: Logger | undefined;

const ctxFor = (args: string[], extra: Record<string, unknown> = {}): CommandContext => ({
  agnosRoot: tmp,
  projectRoot: tmp,
  cacheDir: path.join(tmp, ".agnos", "cache"),
  configPath: path.join(tmp, "agnos.json"),
  statePath: path.join(tmp, ".agnos", "state.json"),
  logger: capturedLogger ?? createLogger({ quiet: true }),
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
  capturedLogger = undefined;
  await writeCfg({});
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("mcp subcommands", () => {
  const regResponse = (body: unknown, status = 200): Response =>
    ({
      ok: status >= 200 && status < 300,
      status,
      statusText: "test",
      json: async () => body,
    }) as Response;

  const serverEntry = (server: unknown) => ({
    server,
    _meta: { "io.modelcontextprotocol.registry/official": { status: "active" } },
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("add from the registry installs the chosen server with source + version (-y auto-selects)", async () => {
    const listing = {
      servers: [
        serverEntry({
          name: "io.github.acme/weather",
          title: "Weather",
          description: "Weather data",
          version: "1.2.3",
          packages: [
            {
              registryType: "npm",
              identifier: "@acme/weather",
              version: "1.2.3",
              transport: { type: "stdio" },
              environmentVariables: [{ name: "API_KEY" }],
            },
          ],
        }),
      ],
      metadata: { count: 1 },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => regResponse(listing)),
    );
    await run(mcpDomain, "add", ["weather"]);
    expect((await readCfg()).mcp).toEqual([
      {
        name: "weather",
        source: "io.github.acme/weather",
        version: "1.2.3",
        command: "npx",
        transport: "stdio",
        args: ["-y", "@acme/weather@1.2.3"],
        env: { API_KEY: "" },
      },
    ]);
  });

  it("manual add (no term) is guarded when non-interactive", async () => {
    await expect(run(mcpDomain, "add", [])).rejects.toThrow(/interactive terminal/);
  });

  it("update bumps a stale registry-managed server, preserving user env; leaves manual servers", async () => {
    await writeCfg({
      mcp: [
        {
          name: "weather",
          source: "io.github.acme/weather",
          version: "1.0.0",
          command: "npx",
          transport: "stdio",
          args: ["-y", "@acme/weather@1.0.0"],
          env: { API_KEY: "secret" },
        },
        { name: "manual", command: "node", transport: "stdio" },
      ],
    });
    const latest = {
      server: {
        name: "io.github.acme/weather",
        version: "2.0.0",
        packages: [
          {
            registryType: "npm",
            identifier: "@acme/weather",
            version: "2.0.0",
            transport: { type: "stdio" },
            environmentVariables: [{ name: "API_KEY" }],
          },
        ],
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => regResponse(latest)),
    );
    await run(mcpDomain, "update", []);
    const cfg = await readCfg();
    const weather = cfg.mcp?.find((m) => m.name === "weather");
    expect(weather?.version).toBe("2.0.0");
    expect(weather?.args).toEqual(["-y", "@acme/weather@2.0.0"]);
    expect(weather?.env).toEqual({ API_KEY: "secret" });
    expect(cfg.mcp?.find((m) => m.name === "manual")).toEqual({
      name: "manual",
      command: "node",
      transport: "stdio",
    });
  });

  it("remove drops named servers; missing throws; no-arg is guarded", async () => {
    await writeCfg({
      mcp: [
        { name: "gh", command: "npx", transport: "stdio" },
        { name: "fs", command: "npx", transport: "stdio" },
      ],
    });
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

  it("warns which installed agents don't support the event when adding", async () => {
    await writeCfg({ agents: ["claude-code", "codex", "gemini-cli"] });
    const warnings: string[] = [];
    capturedLogger = { ...createLogger({ quiet: true }), warn: (m) => warnings.push(String(m)) };
    // Notification is unsupported by codex; SubagentStop is unsupported by gemini-cli.
    await run(hooksDomain, "add", ["Notification", "notify.sh"]);
    expect(warnings.some((w) => w.includes("Notification") && w.includes("OpenAI Codex"))).toBe(
      true,
    );
    await run(hooksDomain, "add", ["SubagentStop", "sub.sh"]);
    expect(warnings.some((w) => w.includes("SubagentStop") && w.includes("Gemini CLI"))).toBe(true);
  });

  it("does not warn when every installed agent supports the event", async () => {
    await writeCfg({ agents: ["claude-code", "codex", "gemini-cli"] });
    const warnings: string[] = [];
    capturedLogger = { ...createLogger({ quiet: true }), warn: (m) => warnings.push(String(m)) };
    await run(hooksDomain, "add", ["PreToolUse", "guard.sh"]); // supported by all three
    expect(warnings).toEqual([]);
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
      /No skills found in \.\/empty/,
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

  it("add accepts several ids at once and is idempotent on re-add", async () => {
    await run(agentsDomain, "add", ["claude-code", "codex"]);
    expect((await readCfg()).agents).toEqual(["claude-code", "codex"]);
    // Re-adding an already-enabled agent leaves the list untouched.
    await run(agentsDomain, "add", ["claude-code"]);
    expect((await readCfg()).agents).toEqual(["claude-code", "codex"]);
  });

  it("add reports every unknown id in one error", async () => {
    await expect(run(agentsDomain, "add", ["zed", "nano"])).rejects.toThrow(/zed, nano/);
  });

  it("add with no ids and no TTY refuses with a hint instead of hanging", async () => {
    // `-y` is ignored by these commands; only the missing TTY guards the prompt.
    await expect(run(agentsDomain, "add", [])).rejects.toThrow(/needs a TTY/);
  });

  it("remove drops several ids and cleans non-enabled requests", async () => {
    await writeCfg({ agents: ["claude-code", "codex"] });
    await run(agentsDomain, "remove", ["claude-code", "codex"]);
    expect((await readCfg()).agents).toEqual([]);
  });

  it("remove rejects ids that are not enabled", async () => {
    await writeCfg({ agents: ["claude-code"] });
    await expect(run(agentsDomain, "remove", ["codex"])).rejects.toThrow(/not enabled/);
  });

  it("remove with no ids and no TTY refuses with a hint", async () => {
    await writeCfg({ agents: ["claude-code"] });
    await expect(run(agentsDomain, "remove", [])).rejects.toThrow(/needs a TTY/);
  });
});
