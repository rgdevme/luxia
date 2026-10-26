import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { MaterializeContext, ResolvedMcp } from "../../src/core/index.js";
import { createLogger, SCHEMA_VERSION } from "../../src/core/index.js";
import claudeCode from "../../src/harnesses/adapters/claude-code/index.js";
import codex from "../../src/harnesses/adapters/codex/index.js";
import geminiCli from "../../src/harnesses/adapters/gemini-cli/index.js";

let tmp: string;

function ctxFor(root: string): MaterializeContext {
  return {
    agnosRoot: root,
    projectRoot: root,
    storeDir: path.join(root, "store"),
    configPath: path.join(root, "agnos.json"),
    logger: createLogger({ quiet: true }),
    fetcher: {} as never,
    linker: {} as never,
    dryRun: false,
    indent: "",
    harnessId: "test",
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
        env: ["TOKEN"],
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

  it("claims the files it owns", async () => {
    const ctx = ctxFor(tmp);
    const claims = await claudeCode.claims!(ctx);
    expect(claims).toContain(path.join(tmp, ".mcp.json"));
    expect(claims).not.toContain(path.join(tmp, ".claude", "skills"));
  });
});

describe("codex adapter", () => {
  it("preserves native Codex settings while updating managed MCP servers", async () => {
    const ctx = ctxFor(tmp);
    const configPath = path.join(tmp, ".codex", "config.toml");
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, 'approval_policy = "never"\n\n[features]\nplugins = true\n');

    await codex.render!["mcp"]!(SERVERS, ctx);
    const rendered = await fs.readFile(configPath, "utf8");
    expect(rendered).toContain('approval_policy = "never"');
    expect(rendered).toContain("[features]");
    expect(rendered).toContain("[mcp_servers.fs]");

    await codex.cleanup!(ctx);
    const cleaned = await fs.readFile(configPath, "utf8");
    expect(cleaned).toContain('approval_policy = "never"');
    expect(cleaned).toContain("[features]");
    expect(cleaned).not.toContain("mcp_servers");
  });

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
        env: ["TOKEN"],
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

  it("does not claim native Codex config or the skills directory", async () => {
    const ctx = ctxFor(tmp);
    const claims = await codex.claims!(ctx);
    expect(claims).not.toContain(path.join(tmp, ".codex", "config.toml"));
    expect(claims).not.toContain(path.join(tmp, ".agents", "skills"));
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
        env: ["TOKEN"],
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

  it("skips an mcp server with no command/url rather than writing an empty value", async () => {
    const ctx = ctxFor(tmp);
    const servers: ResolvedMcp[] = [
      { name: "broken", transport: "http" }, // no command → invalid
      { name: "ok", command: "npx", args: ["-y", "x"], transport: "stdio" },
    ];
    await geminiCli.render!["mcp"]!(servers, ctx);
    const written = JSON.parse(
      await fs.readFile(path.join(tmp, ".gemini", "settings.json"), "utf8"),
    );
    expect(written.mcpServers.broken).toBeUndefined();
    expect(written.mcpServers.ok).toEqual({ command: "npx", args: ["-y", "x"] });
  });

  it("claims the GEMINI.md mirror and skills dir, not the shared settings file", async () => {
    const ctx = ctxFor(tmp);
    await fs.writeFile(
      path.join(tmp, "agnos.json"),
      JSON.stringify({ schemaVersion: SCHEMA_VERSION, rules: { fragments: { "AGENTS.md": [] } } }),
    );
    const claims = await geminiCli.claims!(ctx);
    expect(claims).toContain(path.join(tmp, "GEMINI.md"));
    expect(claims).toContain(path.join(tmp, ".gemini", "skills"));
    expect(claims).not.toContain(path.join(tmp, ".gemini", "settings.json"));
  });
});
