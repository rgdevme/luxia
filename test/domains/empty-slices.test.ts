import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type {
  AgnosConfig,
  DomainRunOptions,
  MaterializeContext,
  RunContext,
} from "../../src/core/index.js";
import { createLogger } from "../../src/core/index.js";
import docsDomain from "../../src/domains/docs/index.js";
import rulesDomain from "../../src/domains/rules/index.js";
import claudeCode from "../../src/agents/adapters/claude-code/index.js";
import codex from "../../src/agents/adapters/codex/index.js";

let tmp: string;

function base(root: string) {
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
  };
}
const runCtx = (root: string): RunContext => ({
  ...base(root),
  flags: { dry: false, once: true, quiet: true, help: false, init: false, yes: true },
});
const matCtx = (root: string): MaterializeContext => ({ ...base(root), agentId: "x", indent: "" });
const OPTS: DomainRunOptions = { dry: false, once: true, quiet: true, interactive: false };
const writeConfig = (cfg: AgnosConfig) =>
  fs.writeFile(path.join(tmp, "agnos.json"), JSON.stringify(cfg));
const exists = (rel: string) =>
  fs.access(path.join(tmp, rel)).then(
    () => true,
    () => false,
  );

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-empty-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("empty slices generate no files", () => {
  it("docs.run does nothing when docs.root is undefined", async () => {
    await writeConfig({ schemaVersion: 1, agents: [] });
    await docsDomain.run!(OPTS, runCtx(tmp));
    expect(await exists(".docs/index.md")).toBe(false);
  });

  it("rules.run does nothing when rules.files is empty", async () => {
    await writeConfig({ schemaVersion: 1, rules: { files: {} } });
    await rulesDomain.run!(OPTS, runCtx(tmp));
    expect(await exists("AGENTS.md")).toBe(false);
  });

  it("claude mcp render writes no .mcp.json for an empty list (and removes a stale one)", async () => {
    await fs.writeFile(path.join(tmp, ".mcp.json"), '{"mcpServers":{"old":{}}}');
    await claudeCode.render!["mcp"]!([], matCtx(tmp));
    expect(await exists(".mcp.json")).toBe(false);
  });

  it("codex mcp render writes no .codex/config.toml for an empty list (and removes a stale one)", async () => {
    await fs.mkdir(path.join(tmp, ".codex"), { recursive: true });
    await fs.writeFile(path.join(tmp, ".codex", "config.toml"), "[mcp_servers.old]\n");
    await codex.render!["mcp"]!([], matCtx(tmp));
    expect(await exists(".codex/config.toml")).toBe(false);
  });

  it("claude hooks render leaves no hooks when the list is empty", async () => {
    await claudeCode.render!["hooks"]!([], matCtx(tmp));
    expect(await exists(".claude/settings.json")).toBe(false);
  });

  it("rules slice renders no per-agent file when there are no canonical files", async () => {
    // empty rules.files → resolveSlices yields [] → mirrorRules no-ops (no CLAUDE.md)
    await claudeCode.render!["rules"]!([], matCtx(tmp));
    expect(await exists("CLAUDE.md")).toBe(false);
  });
});
