import { constants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashSkillDir } from "../../src/core/skill-hash.js";
import { materializeSkill } from "../../src/core/skill-materialize.js";

let root: string;
let stored: string;
let destination: string;
let hash: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-materialize-"));
  stored = path.join(root, "store", "skill");
  destination = path.join(root, "project", "skill");
  await fs.mkdir(path.join(stored, "nested"), { recursive: true });
  await fs.writeFile(path.join(stored, "SKILL.md"), "# Test\n");
  await fs.writeFile(path.join(stored, "nested", "data.txt"), "data\n");
  hash = await hashSkillDir(stored);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

describe("materializeSkill", () => {
  it("imports an independent project tree and skips an unchanged materialization", async () => {
    const first = await materializeSkill(stored, destination, hash);
    expect(first.changed).toBe(true);
    expect(await hashSkillDir(destination)).toBe(hash);

    await fs.rm(path.join(root, "store"), { recursive: true, force: true });
    expect(await fs.readFile(path.join(destination, "SKILL.md"), "utf8")).toBe("# Test\n");

    const second = await materializeSkill(destination, destination, hash, hash);
    expect(second.changed).toBe(false);
  });

  it("falls back to hard links when forced cloning is unavailable", async () => {
    const copyFile = fs.copyFile.bind(fs);
    vi.spyOn(fs, "copyFile").mockImplementation(async (source, target, mode) => {
      if (mode === constants.COPYFILE_FICLONE_FORCE) throw new Error("clone unavailable");
      await copyFile(source, target, mode);
    });

    const result = await materializeSkill(stored, destination, hash);

    expect(result.methods).toEqual(new Set(["hardlink"]));
    expect(await hashSkillDir(destination)).toBe(hash);
  });

  it("falls back to copies when cloning and hard links are unavailable", async () => {
    const copyFile = fs.copyFile.bind(fs);
    const link = vi.spyOn(fs, "link").mockRejectedValue(new Error("cross-device"));
    vi.spyOn(fs, "copyFile").mockImplementation(async (source, target, mode) => {
      if (mode === constants.COPYFILE_FICLONE_FORCE) throw new Error("clone unavailable");
      await copyFile(source, target, mode);
    });

    const result = await materializeSkill(stored, destination, hash);

    expect(link).toHaveBeenCalled();
    expect(result.methods).toEqual(new Set(["copy"]));
    expect(await hashSkillDir(destination)).toBe(hash);
  });
});
