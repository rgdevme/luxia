import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ensureStoredSkill, resolveStoredSkill } from "../../src/core/skill-store.js";
import { hashSkillDir } from "../../src/core/skill-hash.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-skill-store-"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

describe("skill store publication", () => {
  it("retries a transient Windows rename failure without deleting the final path", async () => {
    const source = path.join(root, "source");
    const storeDir = path.join(root, "store");
    await fs.mkdir(source, { recursive: true });
    await fs.writeFile(path.join(source, "SKILL.md"), "# Test\n");
    const hash = await hashSkillDir(source);
    const stored = resolveStoredSkill(storeDir, hash);
    const rename = fs.rename.bind(fs);
    let attempts = 0;
    const renameSpy = vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error("file is busy") as NodeJS.ErrnoException;
        error.code = "EPERM";
        throw error;
      }
      await rename(from, to);
    });
    const rmSpy = vi.spyOn(fs, "rm");

    expect(await ensureStoredSkill(source, storeDir, hash)).toBe(stored);
    expect(renameSpy).toHaveBeenCalledTimes(2);
    expect(rmSpy.mock.calls.some(([target]) => path.resolve(String(target)) === stored)).toBe(
      false,
    );
    expect(await fs.readFile(path.join(stored, "SKILL.md"), "utf8")).toBe("# Test\n");
  });

  it("replaces a corrupt entry before reuse", async () => {
    const source = path.join(root, "source");
    const storeDir = path.join(root, "store");
    await fs.mkdir(source, { recursive: true });
    await fs.writeFile(path.join(source, "SKILL.md"), "# Valid\n");
    const hash = await hashSkillDir(source);
    const stored = resolveStoredSkill(storeDir, hash);
    await fs.mkdir(stored, { recursive: true });
    await fs.writeFile(path.join(stored, "SKILL.md"), "# Corrupt\n");

    await ensureStoredSkill(source, storeDir, hash);

    expect(await fs.readFile(path.join(stored, "SKILL.md"), "utf8")).toBe("# Valid\n");
  });

  it("does not publish symbolic links excluded from the skill hash", async () => {
    const source = path.join(root, "source");
    const external = path.join(root, "external");
    const storeDir = path.join(root, "store");
    await fs.mkdir(source, { recursive: true });
    await fs.mkdir(external, { recursive: true });
    await fs.writeFile(path.join(source, "SKILL.md"), "# Valid\n");
    await fs.writeFile(path.join(external, "secret.txt"), "secret\n");
    await fs.symlink(
      external,
      path.join(source, "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const hash = await hashSkillDir(source);

    const stored = await ensureStoredSkill(source, storeDir, hash);

    await expect(fs.access(path.join(stored, "linked"))).rejects.toThrow();
  });
});
