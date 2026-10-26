import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { CommandContext, Domain, Logger } from "../../src/core/index.js";
import { createLogger, createRepoFetcher, readConfigOrDefault } from "../../src/core/index.js";
import mcpDomain from "../../src/domains/mcp/index.js";
import skillsDomain from "../../src/domains/skills/index.js";
import { harnessDomain } from "../../src/domains/harness/index.js";

let tmp: string;

let capturedLogger: Logger | undefined;

const ctxFor = (args: string[], extra: Record<string, unknown> = {}): CommandContext => ({
  agnosRoot: tmp,
  projectRoot: tmp,
  storeDir: path.join(tmp, "store"),
  configPath: path.join(tmp, "agnos.json"),
  logger: capturedLogger ?? createLogger({ quiet: true }),
  // Real fetcher: for `file:` (local) sources it just returns the absolute path,
  // so skills `add` discovery works without any network access.
  fetcher: createRepoFetcher({ stagingDir: path.join(tmp, ".agnos", "tmp", "repos") }),
  linker: {} as never,
  repositoryTracker: {
    add: async () => {
      throw new Error("unexpected tracker acquisition");
    },
    update: async () => {
      throw new Error("unexpected tracker update");
    },
    shouldUpdate: async () => false,
    remove: async () => {},
    listRegistrations: async () => [],
  },
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
    expect((await readCfg()).mcp).toEqual({
      servers: [
        {
          name: "weather",
          source: "io.github.acme/weather",
          version: "1.2.3",
          command: "npx",
          transport: "stdio",
          args: ["-y", "@acme/weather@1.2.3"],
          env: ["API_KEY"],
        },
      ],
    });
  });

  it("manual add (no term) is guarded when non-interactive", async () => {
    await expect(run(mcpDomain, "add", [])).rejects.toThrow(/interactive terminal/);
  });

  it("update bumps a stale registry-managed server, preserving user env; leaves manual servers", async () => {
    await writeCfg({
      mcp: {
        servers: [
          {
            name: "weather",
            source: "io.github.acme/weather",
            version: "1.0.0",
            command: "npx",
            transport: "stdio",
            args: ["-y", "@acme/weather@1.0.0"],
            env: ["API_KEY"],
          },
          { name: "manual", command: "node", transport: "stdio" },
        ],
      },
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
    const weather = cfg.mcp?.servers?.find((m) => m.name === "weather");
    expect(weather?.version).toBe("2.0.0");
    expect(weather?.args).toEqual(["-y", "@acme/weather@2.0.0"]);
    expect(weather?.env).toEqual(["API_KEY"]);
    expect(cfg.mcp?.servers?.find((m) => m.name === "manual")).toEqual({
      name: "manual",
      command: "node",
      transport: "stdio",
    });
  });

  it("remove drops named servers; missing throws; no-arg is guarded", async () => {
    await writeCfg({
      mcp: {
        servers: [
          { name: "gh", command: "npx", transport: "stdio" },
          { name: "fs", command: "npx", transport: "stdio" },
        ],
      },
    });
    await expect(run(mcpDomain, "remove", ["nope"])).rejects.toThrow(/not found/);
    // no names + non-interactive (yes flag / no TTY) → guarded, doesn't prompt
    await expect(run(mcpDomain, "remove", [])).rejects.toThrow(/specify server/i);
    await run(mcpDomain, "remove", ["gh", "fs"]);
    expect((await readCfg()).mcp).toEqual({ servers: [] });
  });

  it("migrate imports servers from an active agent's native config", async () => {
    await writeCfg({ harness: ["claude-code"] });
    await fs.writeFile(
      path.join(tmp, ".mcp.json"),
      JSON.stringify({ mcpServers: { gh: { command: "npx", args: ["s"] } } }),
    );
    await run(mcpDomain, "migrate", [], { missing: true });
    expect((await readCfg()).mcp?.servers?.map((m) => m.name)).toEqual(["gh"]);
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
      pdf: { source: "file:./src-skills/skills/pdf", glob: "." },
    });
  });

  it("add under -y installs every discovered skill", async () => {
    await makeSkillSource("src-skills", ["pdf", "lint"]);
    await run(skillsDomain, "add", ["./src-skills"], { provider: "file" });
    expect((await readCfg()).skills?.sources).toEqual({
      pdf: { source: "file:./src-skills/skills/pdf", glob: "." },
      lint: { source: "file:./src-skills/skills/lint", glob: "." },
    });
  });

  it("add across multiple sources aggregates skills under their own names", async () => {
    await makeSkillSource("one", ["pdf"]);
    await makeSkillSource("two", ["lint"]);
    await run(skillsDomain, "add", ["./one", "./two"], { provider: "file" });
    expect((await readCfg()).skills?.sources).toEqual({
      pdf: { source: "file:./one/skills/pdf", glob: "." },
      lint: { source: "file:./two/skills/lint", glob: "." },
    });
  });

  it("add -y resolves a same-name collision to the last-declared source", async () => {
    await makeSkillSource("one", ["pdf"]);
    await makeSkillSource("two", ["pdf"]);
    // Both sources expose a "pdf"; -y picks the last declared (./two) for that name.
    await run(skillsDomain, "add", ["./one", "./two"], { provider: "file" });
    expect((await readCfg()).skills?.sources).toEqual({
      pdf: { source: "file:./two/skills/pdf", glob: "." },
    });
  });

  it("add --skills resolves a same-name collision to the last-declared source", async () => {
    await makeSkillSource("one", ["pdf"]);
    await makeSkillSource("two", ["pdf"]);
    await run(skillsDomain, "add", ["./one", "./two"], { provider: "file", skills: "pdf" });
    expect((await readCfg()).skills?.sources).toEqual({
      pdf: { source: "file:./two/skills/pdf", glob: "." },
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
    await writeCfg({
      skills: { sources: { pdf: { source: "file:./stale/skills/pdf", glob: "." } } },
    });
    await run(skillsDomain, "add", ["./src-skills"], { provider: "file", skills: "pdf" });
    expect((await readCfg()).skills?.sources["pdf"]).toEqual({
      source: "file:./src-skills/skills/pdf",
      glob: ".",
    });
  });

  it("add reports a clear error when the source has no skills", async () => {
    await fs.mkdir(path.join(tmp, "empty"), { recursive: true });
    await expect(run(skillsDomain, "add", ["./empty"], { provider: "file" })).rejects.toThrow(
      /No skills found in \.\/empty/,
    );
  });

  it("check reports incompatible metadata without fetching or modifying the skill", async () => {
    const skillDirectory = path.join(tmp, ".agnos", "skills", "pdf");
    await fs.mkdir(skillDirectory, { recursive: true });
    await fs.writeFile(path.join(skillDirectory, "SKILL.md"), "---\nname: pdf\n---\n# PDF\n");
    await writeCfg({ harness: ["codex"], skills: { dir: ".agnos/skills" } });
    const logger = createLogger({ quiet: true });
    const warn = vi.spyOn(logger, "warn");
    capturedLogger = logger;

    await run(skillsDomain, "check", [], { skills: "pdf", harness: "codex" });

    expect(warn).toHaveBeenCalled();
    await expect(fs.access(path.join(tmp, "agnos.lock.json"))).rejects.toThrow();
  });

  it("remove deletes multiple named skills; no-name + non-interactive errors", async () => {
    await writeCfg({
      skills: {
        sources: {
          a: { source: "github:o/r", glob: "skills/a" },
          b: { source: "github:o/r", glob: "skills/b" },
        },
      },
    });
    await run(skillsDomain, "remove", ["a", "b"]);
    expect((await readCfg()).skills?.sources ?? {}).toEqual({});
    await writeCfg({ skills: { sources: { c: { source: "github:o/r", glob: "skills/c" } } } });
    // no names + non-interactive (yes flag) → errors instead of hanging on a prompt
    await expect(run(skillsDomain, "remove", [])).rejects.toThrow(/specify skill/i);
  });
});

describe("harness subcommands", () => {
  it("warns about skill metadata but still enables the harness", async () => {
    const skillDirectory = path.join(tmp, ".agnos", "skills", "pdf");
    await fs.mkdir(skillDirectory, { recursive: true });
    await fs.writeFile(path.join(skillDirectory, "SKILL.md"), "# PDF\n");
    const logger = createLogger({ quiet: true });
    const warn = vi.spyOn(logger, "warn");
    capturedLogger = logger;

    await run(harnessDomain, "add", ["codex"]);

    expect((await readCfg()).harness).toEqual(["codex"]);
    expect(warn).toHaveBeenCalled();
  });

  it("add enables a known agent; unknown throws; remove disables it", async () => {
    await run(harnessDomain, "add", ["claude-code"]);
    expect((await readCfg()).harness).toEqual(["claude-code"]);
    await expect(run(harnessDomain, "add", ["zed"])).rejects.toThrow(/unknown harness/);
    await run(harnessDomain, "remove", ["claude-code"]);
    expect((await readCfg()).harness).toEqual([]);
  });

  it("add accepts several ids at once and is idempotent on re-add", async () => {
    await run(harnessDomain, "add", ["claude-code", "codex"]);
    expect((await readCfg()).harness).toEqual(["claude-code", "codex"]);
    // Re-adding an already-enabled harness leaves the list untouched.
    await run(harnessDomain, "add", ["claude-code"]);
    expect((await readCfg()).harness).toEqual(["claude-code", "codex"]);
  });

  it("add reports every unknown id in one error", async () => {
    await expect(run(harnessDomain, "add", ["zed", "nano"])).rejects.toThrow(/zed, nano/);
  });

  it("add with no ids and no TTY refuses with a hint instead of hanging", async () => {
    // `-y` is ignored by these commands; only the missing TTY guards the prompt.
    await expect(run(harnessDomain, "add", [])).rejects.toThrow(/needs a TTY/);
  });

  it("remove drops several ids and cleans non-enabled requests", async () => {
    await writeCfg({ harness: ["claude-code", "codex"] });
    await run(harnessDomain, "remove", ["claude-code", "codex"]);
    expect((await readCfg()).harness).toEqual([]);
  });

  it("remove rejects ids that are not enabled", async () => {
    await writeCfg({ harness: ["claude-code"] });
    await expect(run(harnessDomain, "remove", ["codex"])).rejects.toThrow(/not enabled/);
  });

  it("remove with no ids and no TTY refuses with a hint", async () => {
    await writeCfg({ harness: ["claude-code"] });
    await expect(run(harnessDomain, "remove", [])).rejects.toThrow(/needs a TTY/);
  });
});
