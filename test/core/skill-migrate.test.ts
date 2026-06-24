import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runMigrate } from "../src/commands/skill.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { readLock } from "../src/lock.js";
import { hashSkillDir } from "../src/skill-hash.js";
import { createLogger } from "../src/logger.js";
import type { AgnosConfig, ResolveContext } from "../src/types/public.js";

let root: string;
let repoA: string;
let repoB: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-migrate-"));
  repoA = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-migrate-repoA-"));
  repoB = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-migrate-repoB-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(repoA, { recursive: true, force: true });
  await fs.rm(repoB, { recursive: true, force: true });
});

async function placeSkill(repoRoot: string, rel: string): Promise<void> {
  const dir = path.join(repoRoot, rel);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "SKILL.md"), `# ${path.basename(rel)}\n`);
}

interface MakeCtxOpts {
  dryRun?: boolean;
  fetchByCanonical?: Record<string, string>;
}

function makeCtx(opts: MakeCtxOpts = {}): ResolveContext {
  return {
    projectRoot: root,
    configPath: path.join(root, "agnos.json"),
    statePath: path.join(root, ".agnos", "state.json"),
    agnosRoot: path.join(root, ".agnos"),
    cacheDir: path.join(root, ".agnos", "cache"),
    logger: createLogger({ quiet: true }),
    dryRun: opts.dryRun ?? false,
    fetcher: {
      fetch: async (source) => {
        const target = opts.fetchByCanonical?.[source.canonical];
        if (!target) throw new Error(`unexpected fetch of ${source.canonical}`);
        return { path: target };
      },
    },
    linker: {
      canSymlinkFiles: async () => true,
      canSymlinkDirs: async () => true,
      link: async () => ({ kind: "symlink" }),
      unlink: async () => {},
    },
  };
}

function baseOpts(args: string[] = []): Parameters<typeof runMigrate>[0] {
  return {
    cwd: root,
    sub: "migrate",
    args,
    noInstall: true,
    copyOnNoSymlink: false,
    logger: createLogger({ quiet: true }),
  };
}

async function writeSkillsLock(file: object): Promise<string> {
  const p = path.join(root, "skills-lock.json");
  await fs.writeFile(p, JSON.stringify(file, null, 2));
  return p;
}

describe("runMigrate", () => {
  it("imports resolvable skills, skips missing names with a warning", async () => {
    await placeSkill(repoA, "skills/foo");
    await placeSkill(repoB, "skills/bar");

    await writeSkillsLock({
      version: 1,
      skills: {
        foo: { source: "acme/a", sourceType: "github", computedHash: "deadbeef" },
        bar: { source: "acme/b", sourceType: "github", computedHash: "cafebabe" },
        missing: { source: "acme/a", sourceType: "github", computedHash: "00" },
      },
    });

    const config: AgnosConfig = structuredClone(DEFAULT_CONFIG);
    const ctx = makeCtx({
      fetchByCanonical: {
        "github:acme/a": repoA,
        "github:acme/b": repoB,
      },
    });

    await runMigrate(baseOpts(), ctx, config, []);

    expect(config.skills?.sources).toEqual({
      foo: "github:acme/a/skills/foo",
      bar: "github:acme/b/skills/bar",
    });

    const lock = await readLock(root);
    const fooHash = await hashSkillDir(path.join(repoA, "skills", "foo"));
    const barHash = await hashSkillDir(path.join(repoB, "skills", "bar"));
    expect(lock.skills["github:acme/a/skills/foo"]?.computedHash).toBe(fooHash);
    expect(lock.skills["github:acme/b/skills/bar"]?.computedHash).toBe(barHash);

    const materialized = path.join(root, ".agnos", "skills", "foo", "SKILL.md");
    expect((await fs.readFile(materialized, "utf8")).trim()).toBe("# foo");
  });

  it("is idempotent on a second run", async () => {
    await placeSkill(repoA, "skills/foo");
    await writeSkillsLock({
      version: 1,
      skills: { foo: { source: "acme/a", sourceType: "github", computedHash: "x" } },
    });

    const config: AgnosConfig = structuredClone(DEFAULT_CONFIG);
    const ctx = makeCtx({ fetchByCanonical: { "github:acme/a": repoA } });

    await runMigrate(baseOpts(), ctx, config, []);
    const firstSources = { ...(config.skills?.sources ?? {}) };

    await runMigrate(baseOpts(), ctx, config, []);
    expect(config.skills?.sources).toEqual(firstSources);
  });

  it("dry-run does not write agnos.json, lock, or skills dir", async () => {
    await placeSkill(repoA, "skills/foo");
    await writeSkillsLock({
      version: 1,
      skills: { foo: { source: "acme/a", sourceType: "github", computedHash: "x" } },
    });

    const config: AgnosConfig = structuredClone(DEFAULT_CONFIG);
    const ctx = makeCtx({ dryRun: true, fetchByCanonical: { "github:acme/a": repoA } });

    await runMigrate(baseOpts(), ctx, config, []);

    expect(config.skills?.sources ?? {}).toEqual({});
    await expect(fs.access(path.join(root, "agnos.lock.json"))).rejects.toBeTruthy();
    await expect(fs.access(path.join(root, ".agnos", "skills", "foo"))).rejects.toBeTruthy();
  });

  it("fails fast on unsupported sourceType", async () => {
    await writeSkillsLock({
      version: 1,
      skills: { foo: { source: "acme/a", sourceType: "ftp", computedHash: "x" } },
    });

    const config: AgnosConfig = structuredClone(DEFAULT_CONFIG);
    const ctx = makeCtx();

    await expect(runMigrate(baseOpts(), ctx, config, [])).rejects.toThrow(
      /unsupported sourceType "ftp"/,
    );
  });

  it("errors with a friendly message when the file is missing", async () => {
    const config: AgnosConfig = structuredClone(DEFAULT_CONFIG);
    const ctx = makeCtx();
    await expect(runMigrate(baseOpts(["does-not-exist.json"]), ctx, config, [])).rejects.toThrow(
      /skills lock file not found/,
    );
  });

  it("suffixes collisions when an existing name points elsewhere", async () => {
    await placeSkill(repoA, "skills/foo");
    await writeSkillsLock({
      version: 1,
      skills: { foo: { source: "acme/a", sourceType: "github", computedHash: "x" } },
    });

    const config: AgnosConfig = structuredClone(DEFAULT_CONFIG);
    config.skills = { sources: { foo: "github:other/repo/path/foo" } };

    const ctx = makeCtx({ fetchByCanonical: { "github:acme/a": repoA } });
    await runMigrate(baseOpts(), ctx, config, []);

    expect(config.skills?.sources).toMatchObject({
      foo: "github:other/repo/path/foo",
      "foo-2": "github:acme/a/skills/foo",
    });
  });
});
