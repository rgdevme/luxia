import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prepareSkills } from "../src/skill-prepare.js";
import { hashSkillDir } from "../src/skill-hash.js";
import { readLock, writeLock, upsertSkill, emptyLock } from "../src/lock.js";
import { createLogger } from "../src/logger.js";
import type { AgnosConfig, ResolveContext } from "../src/types/public.js";

let root: string;
let repoCache: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-prepare-"));
  repoCache = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-prepare-repo-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(repoCache, { recursive: true, force: true });
});

async function seedSkill(rel: string, body = "# Test\n\n"): Promise<void> {
  const dir = path.join(repoCache, rel);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "SKILL.md"), body);
}

function makeCtx(): ResolveContext {
  return {
    projectRoot: root,
    configPath: path.join(root, "agnos.json"),
    statePath: path.join(root, ".agnos", "state.json"),
    agnosRoot: path.join(root, ".agnos"),
    cacheDir: path.join(root, ".agnos", "cache"),
    logger: createLogger({ quiet: true }),
    // Stub fetcher: every call returns the shared repoCache root. The composite
    // ref's subPath then locates the actual skill within it.
    fetcher: { fetch: async () => ({ path: repoCache }) },
    linker: {
      canSymlinkFiles: async () => true,
      canSymlinkDirs: async () => true,
      link: async () => ({ kind: "symlink" }),
      unlink: async () => {},
    },
  };
}

describe("prepareSkills", () => {
  it("fills missing lock entries (pre-pass) and materializes", async () => {
    await seedSkill("skills/pdf");
    const ctx = makeCtx();
    const config: AgnosConfig = {
      skills: { pdf: "github:foo/bar/skills/pdf" },
    };
    const result = await prepareSkills(config, ctx);
    expect(result.filled).toEqual(["pdf"]);
    expect(result.verified).toEqual([]);

    const lock = await readLock(root);
    const entry = lock.skills["github:foo/bar/skills/pdf"];
    expect(entry?.computedHash).toMatch(/^[a-f0-9]{64}$/);

    const materialized = path.join(root, ".agnos", "skills", "pdf", "SKILL.md");
    expect(await fs.readFile(materialized, "utf8")).toContain("# Test");
  });

  it("passes silently when the lock hash matches", async () => {
    await seedSkill("skills/pdf");
    const ctx = makeCtx();
    const hash = await hashSkillDir(path.join(repoCache, "skills", "pdf"));
    let lock = emptyLock();
    lock = upsertSkill(lock, "github:foo/bar/skills/pdf", {
      computedHash: hash,
      resolvedAt: "t",
    });
    await writeLock(root, lock);

    const config: AgnosConfig = { skills: { pdf: "github:foo/bar/skills/pdf" } };
    const result = await prepareSkills(config, ctx);
    expect(result.filled).toEqual([]);
    expect(result.verified).toEqual(["pdf"]);
  });

  it("fails loudly when the lock hash mismatches the fetched content", async () => {
    await seedSkill("skills/pdf");
    const ctx = makeCtx();
    let lock = emptyLock();
    lock = upsertSkill(lock, "github:foo/bar/skills/pdf", {
      computedHash: "f".repeat(64),
      resolvedAt: "t",
    });
    await writeLock(root, lock);

    const config: AgnosConfig = { skills: { pdf: "github:foo/bar/skills/pdf" } };
    await expect(prepareSkills(config, ctx)).rejects.toThrow(
      /upstream content for "pdf".*has changed.*agnos skill update pdf/s,
    );
  });

  it("errors clearly when the in-repo path is missing", async () => {
    // No seedSkill — repoCache is empty.
    const ctx = makeCtx();
    const config: AgnosConfig = { skills: { pdf: "github:foo/bar/skills/pdf" } };
    await expect(prepareSkills(config, ctx)).rejects.toThrow(
      /not found at github:foo\/bar\/skills\/pdf/,
    );
  });

  it("is a no-op for an empty skills record", async () => {
    const ctx = makeCtx();
    const result = await prepareSkills({ skills: {} }, ctx);
    expect(result).toEqual({ filled: [], verified: [] });
  });
});
