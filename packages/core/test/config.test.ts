import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { readConfig, readConfigOrDefault, writeConfig, DEFAULT_CONFIG } from "../src/config.js";

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
      $schema: "https://agnos.dev/schema/v0.json",
      agents: ["claude-code"],
      rules: { source: "./AGENTS.md" },
      skills: [{ name: "pdf", source: "github:foo/bar/pdf" }],
      mcp: [],
    };
    await writeConfig(configPath, config);

    const raw = await fs.readFile(configPath, "utf8");
    expect(raw.indexOf('"$schema"')).toBeLessThan(raw.indexOf('"agents"'));
    expect(raw.indexOf('"agents"')).toBeLessThan(raw.indexOf('"rules"'));
    expect(raw.indexOf('"rules"')).toBeLessThan(raw.indexOf('"skills"'));
    expect(raw.indexOf('"skills"')).toBeLessThan(raw.indexOf('"mcp"'));

    const reloaded = await readConfig(configPath);
    expect(reloaded).toEqual(config);
  });

  it("rejects schema-invalid configs", async () => {
    await fs.writeFile(configPath, JSON.stringify({ agents: [123] }), "utf8");
    await expect(readConfig(configPath)).rejects.toThrow(/schema validation failed/);
  });

  it("preserves user-added custom keys", async () => {
    const config = {
      agents: [],
      rules: { source: "./AGENTS.md" },
      prompts: [{ name: "user-defined-domain", source: "file:./prompts/a.md" }],
    };
    await writeConfig(configPath, config);
    const reloaded = await readConfig(configPath);
    expect(reloaded["prompts"]).toEqual(config.prompts);
  });
});
