import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { HookEntry, MaterializeContext, ResolvedMcp } from "../../src/core/index.js";
import { createLogger, SCHEMA_VERSION } from "../../src/core/index.js";
import claudeCode from "../../src/agents/adapters/claude-code/index.js";
import codex from "../../src/agents/adapters/codex/index.js";
import geminiCli from "../../src/agents/adapters/gemini-cli/index.js";

let tmp: string;

function ctxFor(root: string): MaterializeContext {
  return {
    agnosRoot: root,
    projectRoot: root,
    cacheDir: path.join(root, ".agnos", "cache"),
    configPath: path.join(root, "agnos.json"),
    statePath: path.join(root, ".agnos", "state.json"),
    logger: createLogger({ quiet: true }),
    fetcher: {} as never,
    linker: {} as never,
    dryRun: false,
    indent: "",
    agentId: "test",
  };
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-adapters-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const SERVERS: ResolvedMcp[] = [
  {
    name: "fs",
    command: "npx",
    args: ["-y", "server-fs"],
    env: { TOKEN: "x" },
    transport: "stdio",
  },
];

const HOOKS: HookEntry[] = [
  { event: "PreToolUse", matcher: "git", type: "command", command: "echo guard", message: "m" },
  { event: "SessionStart", type: "command", command: "date" },
];

describe("claude-code adapter", () => {
  it("mcp render → scrape round-trips", async () => {
    const ctx = ctxFor(tmp);
    await claudeCode.render!["mcp"]!(SERVERS, ctx);
    expect(await fs.readFile(path.join(tmp, ".mcp.json"), "utf8")).toContain("mcpServers");
    const scraped = (await claudeCode.scrape!["mcp"]!(ctx)) as ResolvedMcp[];
    expect(scraped).toEqual([
      {
        name: "fs",
        transport: "stdio",
        command: "npx",
        args: ["-y", "server-fs"],
        env: { TOKEN: "x" },
      },
    ]);
  });

  it("remote mcp render → scrape round-trips with headers", async () => {
    const ctx = ctxFor(tmp);
    const remote: ResolvedMcp[] = [
      {
        name: "hosted",
        command: "https://mcp.acme.com/sse",
        transport: "http",
        headers: { Authorization: "Bearer t" },
      },
    ];
    await claudeCode.render!["mcp"]!(remote, ctx);
    const written = JSON.parse(await fs.readFile(path.join(tmp, ".mcp.json"), "utf8"));
    expect(written.mcpServers.hosted).toEqual({
      type: "http",
      url: "https://mcp.acme.com/sse",
      headers: { Authorization: "Bearer t" },
    });
    const scraped = (await claudeCode.scrape!["mcp"]!(ctx)) as ResolvedMcp[];
    expect(scraped).toEqual([
      {
        name: "hosted",
        transport: "http",
        command: "https://mcp.acme.com/sse",
        headers: { Authorization: "Bearer t" },
      },
    ]);
  });

  it("hooks render → scrape round-trips and preserves other settings keys", async () => {
    const ctx = ctxFor(tmp);
    await fs.mkdir(path.join(tmp, ".claude"), { recursive: true });
    await fs.writeFile(
      path.join(tmp, ".claude", "settings.json"),
      JSON.stringify({ theme: "dark" }),
    );
    await claudeCode.render!["hooks"]!(HOOKS, ctx);
    const settings = JSON.parse(
      await fs.readFile(path.join(tmp, ".claude", "settings.json"), "utf8"),
    );
    expect(settings.theme).toBe("dark"); // untouched
    const scraped = (await claudeCode.scrape!["hooks"]!(ctx)) as HookEntry[];
    expect(scraped).toEqual(HOOKS);
  });

  it("claims the files it owns", async () => {
    const ctx = ctxFor(tmp);
    const claims = await claudeCode.claims!(ctx);
    expect(claims).toContain(path.join(tmp, ".mcp.json"));
    expect(claims).toContain(path.join(tmp, ".claude", "skills"));
  });
});

describe("codex adapter", () => {
  it("mcp render → scrape round-trips (TOML)", async () => {
    const ctx = ctxFor(tmp);
    await codex.render!["mcp"]!(SERVERS, ctx);
    expect(await fs.readFile(path.join(tmp, ".codex", "config.toml"), "utf8")).toContain(
      "mcp_servers",
    );
    const scraped = (await codex.scrape!["mcp"]!(ctx)) as ResolvedMcp[];
    expect(scraped).toEqual([
      {
        name: "fs",
        transport: "stdio",
        command: "npx",
        args: ["-y", "server-fs"],
        env: { TOKEN: "x" },
      },
    ]);
  });

  it("remote mcp render → scrape round-trips with headers (TOML)", async () => {
    const ctx = ctxFor(tmp);
    const remote: ResolvedMcp[] = [
      {
        name: "hosted",
        command: "https://mcp.acme.com/sse",
        transport: "sse",
        headers: { Authorization: "Bearer t" },
      },
    ];
    await codex.render!["mcp"]!(remote, ctx);
    const scraped = (await codex.scrape!["mcp"]!(ctx)) as ResolvedMcp[];
    expect(scraped).toEqual([
      {
        name: "hosted",
        transport: "sse",
        command: "https://mcp.acme.com/sse",
        headers: { Authorization: "Bearer t" },
      },
    ]);
  });

  it("hooks render drops unsupported events; round-trips the supported ones", async () => {
    const ctx = ctxFor(tmp);
    const withUnsupported: HookEntry[] = [
      ...HOOKS,
      { event: "Notification", type: "command", command: "notify" }, // unsupported by codex
    ];
    await codex.render!["hooks"]!(withUnsupported, ctx);
    const scraped = (await codex.scrape!["hooks"]!(ctx)) as HookEntry[];
    // Notification dropped; message dropped (codex has no statusMessage)
    expect(scraped).toEqual([
      { event: "PreToolUse", matcher: "git", type: "command", command: "echo guard" },
      { event: "SessionStart", type: "command", command: "date" },
    ]);
  });

  it("claims the .codex dir and skills link", async () => {
    const ctx = ctxFor(tmp);
    const claims = await codex.claims!(ctx);
    expect(claims).toContain(path.join(tmp, ".codex"));
    expect(claims).toContain(path.join(tmp, ".agents", "skills"));
  });
});

describe("gemini-cli adapter", () => {
  it("mcp render → scrape round-trips and preserves other settings keys", async () => {
    const ctx = ctxFor(tmp);
    await fs.mkdir(path.join(tmp, ".gemini"), { recursive: true });
    await fs.writeFile(
      path.join(tmp, ".gemini", "settings.json"),
      JSON.stringify({ theme: "dark" }),
    );
    await geminiCli.render!["mcp"]!(SERVERS, ctx);
    const settings = JSON.parse(
      await fs.readFile(path.join(tmp, ".gemini", "settings.json"), "utf8"),
    );
    expect(settings.theme).toBe("dark"); // untouched
    expect(settings.mcpServers.fs).toEqual({
      command: "npx",
      args: ["-y", "server-fs"],
      env: { TOKEN: "x" },
    });
    const scraped = (await geminiCli.scrape!["mcp"]!(ctx)) as ResolvedMcp[];
    expect(scraped).toEqual([
      {
        name: "fs",
        transport: "stdio",
        command: "npx",
        args: ["-y", "server-fs"],
        env: { TOKEN: "x" },
      },
    ]);
  });

  it("http transport maps to httpUrl and round-trips", async () => {
    const ctx = ctxFor(tmp);
    const remote: ResolvedMcp[] = [
      {
        name: "hosted",
        command: "https://mcp.acme.com/mcp",
        transport: "http",
        headers: { Authorization: "Bearer t" },
      },
    ];
    await geminiCli.render!["mcp"]!(remote, ctx);
    const written = JSON.parse(
      await fs.readFile(path.join(tmp, ".gemini", "settings.json"), "utf8"),
    );
    expect(written.mcpServers.hosted).toEqual({
      httpUrl: "https://mcp.acme.com/mcp",
      headers: { Authorization: "Bearer t" },
    });
    const scraped = (await geminiCli.scrape!["mcp"]!(ctx)) as ResolvedMcp[];
    expect(scraped).toEqual([
      {
        name: "hosted",
        transport: "http",
        command: "https://mcp.acme.com/mcp",
        headers: { Authorization: "Bearer t" },
      },
    ]);
  });

  it("sse transport maps to url and round-trips", async () => {
    const ctx = ctxFor(tmp);
    const remote: ResolvedMcp[] = [
      { name: "events", command: "https://mcp.acme.com/sse", transport: "sse" },
    ];
    await geminiCli.render!["mcp"]!(remote, ctx);
    const written = JSON.parse(
      await fs.readFile(path.join(tmp, ".gemini", "settings.json"), "utf8"),
    );
    expect(written.mcpServers.events).toEqual({ url: "https://mcp.acme.com/sse" });
    const scraped = (await geminiCli.scrape!["mcp"]!(ctx)) as ResolvedMcp[];
    expect(scraped).toEqual([
      { name: "events", transport: "sse", command: "https://mcp.acme.com/sse" },
    ]);
  });

  it("drops the mcpServers key when no servers remain, keeping other settings", async () => {
    const ctx = ctxFor(tmp);
    await fs.mkdir(path.join(tmp, ".gemini"), { recursive: true });
    await fs.writeFile(
      path.join(tmp, ".gemini", "settings.json"),
      JSON.stringify({ theme: "dark", mcpServers: { old: { command: "x" } } }),
    );
    await geminiCli.render!["mcp"]!([], ctx);
    const settings = JSON.parse(
      await fs.readFile(path.join(tmp, ".gemini", "settings.json"), "utf8"),
    );
    expect(settings).toEqual({ theme: "dark" });
  });

  it("claims the GEMINI.md mirror and settings file", async () => {
    const ctx = ctxFor(tmp);
    await fs.writeFile(
      path.join(tmp, "agnos.json"),
      JSON.stringify({ schemaVersion: SCHEMA_VERSION, rules: { files: { "AGENTS.md": [] } } }),
    );
    const claims = await geminiCli.claims!(ctx);
    expect(claims).toContain(path.join(tmp, "GEMINI.md"));
    expect(claims).toContain(path.join(tmp, ".gemini", "settings.json"));
  });
});
