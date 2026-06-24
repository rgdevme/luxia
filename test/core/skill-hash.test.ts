import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hashSkillDir } from "../src/skill-hash.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-hash-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function write(rel: string, body: string): Promise<void> {
  const full = path.join(root, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, body);
}

describe("hashSkillDir", () => {
  it("returns a 64-char hex digest", async () => {
    await write("SKILL.md", "# pdf\n");
    const h = await hashSkillDir(root);
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic", async () => {
    await write("SKILL.md", "# pdf\n");
    await write("scripts/run.sh", "echo hi\n");
    const a = await hashSkillDir(root);
    const b = await hashSkillDir(root);
    expect(a).toBe(b);
  });

  it("changes when any file content changes", async () => {
    await write("SKILL.md", "# pdf\n");
    const before = await hashSkillDir(root);
    await write("SKILL.md", "# pdf updated\n");
    const after = await hashSkillDir(root);
    expect(before).not.toBe(after);
  });

  it("changes when a file is added", async () => {
    await write("SKILL.md", "# pdf\n");
    const before = await hashSkillDir(root);
    await write("new.txt", "data");
    const after = await hashSkillDir(root);
    expect(before).not.toBe(after);
  });

  it("changes when a file is renamed (same content, new path)", async () => {
    await write("a/SKILL.md", "# pdf\n");
    const a = await hashSkillDir(root);
    await fs.rm(path.join(root, "a"), { recursive: true });
    await write("b/SKILL.md", "# pdf\n");
    const b = await hashSkillDir(root);
    expect(a).not.toBe(b);
  });

  it("ignores subdirectory walk order", async () => {
    // Two trees with the same logical content should hash identically
    // regardless of the order entries happen to appear in readdir.
    await write("a/SKILL.md", "# x\n");
    await write("z/extra.txt", "y\n");
    const first = await hashSkillDir(root);

    const root2 = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-hash-"));
    try {
      await fs.mkdir(path.join(root2, "z"), { recursive: true });
      await fs.writeFile(path.join(root2, "z", "extra.txt"), "y\n");
      await fs.mkdir(path.join(root2, "a"), { recursive: true });
      await fs.writeFile(path.join(root2, "a", "SKILL.md"), "# x\n");
      const second = await hashSkillDir(root2);
      expect(first).toBe(second);
    } finally {
      await fs.rm(root2, { recursive: true, force: true });
    }
  });
});
