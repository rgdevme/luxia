import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { migrateLegacySkillSources } from "../../src/core/skill-migration.js";

let root: string;

afterEach(async () => {
  if (root) await fs.rm(root, { recursive: true, force: true });
});

describe("migrateLegacySkillSources", () => {
  it("normalizes pinned legacy skill requests and carries lock observations forward", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-skill-migration-"));
    const configPath = path.join(root, "agnos.json");
    const oldSource = "github:owner/repo/skills/tool#deadbee";
    await fs.writeFile(
      configPath,
      `${JSON.stringify({ schemaVersion: 1, skills: { sources: { tool: oldSource } } }, null, 2)}\n`,
    );
    await fs.writeFile(
      path.join(root, "agnos.lock.json"),
      `${JSON.stringify({ version: 1, skills: { [oldSource]: { computedHash: "a".repeat(64), resolvedAt: "today", resolvedCommit: "b".repeat(40) } } }, null, 2)}\n`,
    );

    const result = await migrateLegacySkillSources(configPath, root, false, () => {});
    const config = JSON.parse(await fs.readFile(configPath, "utf8"));
    const lock = JSON.parse(await fs.readFile(path.join(root, "agnos.lock.json"), "utf8"));

    expect(result.migrated).toEqual(["tool"]);
    expect(config.skills.sources.tool).toEqual({
      source: "github:owner/repo",
      commit: "deadbee",
      glob: "skills/tool",
    });
    expect(
      lock.skills['{"source":"github:owner/repo","commit":"deadbee","glob":"skills/tool"}'],
    ).toMatchObject({
      resolvedCommit: "b".repeat(40),
    });
  });

  it("keeps legacy branch refs live during dry migration", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-skill-migration-branch-"));
    const configPath = path.join(root, "agnos.json");
    await fs.writeFile(
      configPath,
      `${JSON.stringify({ schemaVersion: 1, skills: { sources: { tool: "github:owner/repo/skills/tool#develop" } } }, null, 2)}\n`,
    );

    const result = await migrateLegacySkillSources(configPath, root, true, () => {});

    expect(result.config?.skills?.sources?.tool).toEqual({
      source: "github:owner/repo",
      branch: "develop",
      glob: "skills/tool",
    });
  });

  it("describes a dry migration without writing either file", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-skill-migration-dry-"));
    const configPath = path.join(root, "agnos.json");
    const original = `${JSON.stringify({ schemaVersion: 1, skills: { sources: { tool: "file:./skill" } } }, null, 2)}\n`;
    await fs.writeFile(configPath, original);

    const result = await migrateLegacySkillSources(configPath, root, true, () => {});

    expect(result.config?.skills?.sources?.tool).toEqual({ source: "file:./skill", glob: "." });
    expect(await fs.readFile(configPath, "utf8")).toBe(original);
    await expect(fs.access(path.join(root, "agnos.lock.json"))).rejects.toThrow();
  });
});
