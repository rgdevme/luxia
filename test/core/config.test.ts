import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  readConfig,
  readConfigOrDefault,
  writeConfig,
  DEFAULT_CONFIG,
} from "../../src/core/config.js";

describe("config", () => {
  let dir: string;
  let configPath: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-config-"));
    configPath = path.join(dir, "agnos.json");
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("readConfigOrDefault returns DEFAULT_CONFIG when file is missing", async () => {
    const config = await readConfigOrDefault(configPath);
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("round-trips a config preserving top-level key order", async () => {
    const config = {
      $schema: "https://unpkg.com/@luxia/agnos/schema.json",
      schemaVersion: 1,
      harness: ["claude-code"],
      rules: { fragments: { "./AGENTS.md": [] } },
      skills: { sources: { pdf: { source: "github:foo/bar", glob: "skills/pdf" } } },
      mcp: { servers: [] },
    };
    await writeConfig(configPath, config);

    const raw = await fs.readFile(configPath, "utf8");
    expect(raw.indexOf('"$schema"')).toBeLessThan(raw.indexOf('"schemaVersion"'));
    expect(raw.indexOf('"schemaVersion"')).toBeLessThan(raw.indexOf('"harness"'));
    expect(raw.indexOf('"harness"')).toBeLessThan(raw.indexOf('"rules"'));
    expect(raw.indexOf('"rules"')).toBeLessThan(raw.indexOf('"skills"'));

    const reloaded = await readConfig(configPath);
    expect(reloaded).toEqual(config);
  });

  it("rejects a config missing schemaVersion with a pointer to `agnos --init`", async () => {
    await fs.writeFile(configPath, JSON.stringify({ harness: ["claude-code"] }), "utf8");
    await expect(readConfig(configPath)).rejects.toThrow(/schemaVersion/);
  });

  it("rejects a schema-invalid config (right version, bad shape)", async () => {
    await fs.writeFile(configPath, JSON.stringify({ schemaVersion: 1, harness: [123] }), "utf8");
    await expect(readConfig(configPath)).rejects.toThrow(/schema validation failed/);
  });

  it("explains the agents to harness config-key cutover", async () => {
    await fs.writeFile(configPath, JSON.stringify({ schemaVersion: 1, agents: ["codex"] }), "utf8");
    await expect(readConfig(configPath)).rejects.toThrow(/rename it to "harness"/);
  });

  it("explains that hooks are no longer managed by Agnos", async () => {
    await fs.writeFile(configPath, JSON.stringify({ schemaVersion: 1, hooks: [] }), "utf8");
    await expect(readConfig(configPath)).rejects.toThrow(/hooks are no longer managed/);
  });

  it("preserves user-added custom keys", async () => {
    const config = {
      schemaVersion: 1,
      harness: [],
      rules: { fragments: {} },
      prompts: [{ name: "user-defined-domain", source: "file:./prompts/a.md" }],
    };
    await writeConfig(configPath, config);
    const reloaded = await readConfig(configPath);
    expect(reloaded["prompts"]).toEqual(config.prompts);
  });
});
