import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { findSkillsInRepo } from "../../src/core/skill-discovery.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-discover-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function placeSkill(rel: string, body = "# Test Skill\n\nDescription."): Promise<void> {
  const dir = path.join(root, rel);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "SKILL.md"), body);
}

describe("findSkillsInRepo", () => {
  it("finds skills under ./skills/* (the conventional layout)", async () => {
    await placeSkill("skills/pdf");
    await placeSkill("skills/web-design");

    const out = await findSkillsInRepo(root);
    expect(out.map((d) => d.path)).toEqual(["skills/pdf", "skills/web-design"]);
    expect(out[0]).toMatchObject({ defaultName: "pdf", title: "Test Skill" });
  });

  it("only looks under the root skills/ dir, ignoring skills elsewhere", async () => {
    await placeSkill("packages/foo/agent-skills/data-cleanup");
    await placeSkill("docs/skills/api-reference");
    await placeSkill("skills/keep-me");

    const out = await findSkillsInRepo(root);
    expect(out.map((d) => d.path)).toEqual(["skills/keep-me"]);
  });

  it("returns empty when the repo has no root skills/ dir", async () => {
    await placeSkill("packages/foo/skills/nested");
    expect(await findSkillsInRepo(root)).toEqual([]);
  });

  it("skips standard build / VCS directories", async () => {
    await placeSkill("node_modules/some-pkg/SKILL-source/pdf");
    await placeSkill(".git/skills/leak");
    await placeSkill("dist/snapshot/pdf");
    await placeSkill(".agnos/skills/already-installed");
    await placeSkill("skills/keep-me");

    const out = await findSkillsInRepo(root);
    expect(out.map((d) => d.path)).toEqual(["skills/keep-me"]);
  });

  it("does not descend into a skill directory once it finds a SKILL.md", async () => {
    await placeSkill("skills/parent");
    // A nested 'skill' inside another skill should NOT be reported separately.
    await fs.mkdir(path.join(root, "skills/parent/inner"), { recursive: true });
    await fs.writeFile(path.join(root, "skills/parent/inner/SKILL.md"), "# Inner");

    const out = await findSkillsInRepo(root);
    expect(out.map((d) => d.path)).toEqual(["skills/parent"]);
  });

  it("returns empty when no SKILL.md anywhere", async () => {
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "src/index.ts"), "// nothing here");
    expect(await findSkillsInRepo(root)).toEqual([]);
  });

  it("extracts title from the first markdown heading", async () => {
    await placeSkill("skills/with-title", "# A Catchy Title\n\nBody");
    await placeSkill("skills/no-title", "Just paragraph text.");
    const out = await findSkillsInRepo(root);
    const byPath = Object.fromEntries(out.map((d) => [d.path, d]));
    expect(byPath["skills/with-title"]?.title).toBe("A Catchy Title");
    expect(byPath["skills/no-title"]?.title).toBeUndefined();
  });

  it("extracts description from the SKILL.md frontmatter", async () => {
    await placeSkill(
      "skills/pdf",
      "---\nname: pdf\ndescription: Read and edit PDF files.\n---\n# PDF\n\nBody",
    );
    await placeSkill("skills/no-fm", "# No frontmatter\n\nBody");
    const out = await findSkillsInRepo(root);
    const byPath = Object.fromEntries(out.map((d) => [d.path, d]));
    expect(byPath["skills/pdf"]?.description).toBe("Read and edit PDF files.");
    expect(byPath["skills/pdf"]?.title).toBe("PDF");
    expect(byPath["skills/no-fm"]?.description).toBeUndefined();
  });
});
