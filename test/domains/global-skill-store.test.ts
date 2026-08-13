import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgnosConfig, ResolveContext } from "../../src/core/index.js";
import { createLinker, createLogger, hashSkillDir, writeLock } from "../../src/core/index.js";
import { createSkillSteps } from "../../src/domains/skills/steps.js";
import { runSkillPipeline } from "../../src/domains/skills/pipeline.js";

const COMPOSITE = "github:owner/repo/skills/tool#main";
const CONFIG: AgnosConfig = {
  schemaVersion: 1,
  skills: { sources: { tool: COMPOSITE } },
};

let root: string;
let checkout: string;
let storeDir: string;
let hash: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-global-store-"));
  checkout = path.join(root, "checkout");
  storeDir = path.join(root, "store");
  await fs.mkdir(path.join(checkout, "skills", "tool"), { recursive: true });
  await fs.writeFile(path.join(checkout, "skills", "tool", "SKILL.md"), "# Shared\n");
  hash = await hashSkillDir(path.join(checkout, "skills", "tool"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function context(projectRoot: string, fetch: ResolveContext["fetcher"]["fetch"]): ResolveContext {
  const logger = createLogger({ quiet: true });
  return {
    agnosRoot: path.join(projectRoot, ".agnos"),
    projectRoot,
    storeDir,
    configPath: path.join(projectRoot, "agnos.json"),
    statePath: path.join(projectRoot, ".agnos", "state.json"),
    logger,
    fetcher: { fetch, cleanup: async () => {} },
    linker: createLinker({ probeDir: path.join(projectRoot, ".agnos", "tmp"), logger }),
    dryRun: false,
  };
}

async function seedLock(
  projectRoot: string,
  resolvedCommit: string | null = "deadbeef",
): Promise<void> {
  await fs.mkdir(projectRoot, { recursive: true });
  await writeLock(projectRoot, {
    version: 1,
    skills: {
      [COMPOSITE]: {
        computedHash: hash,
        resolvedAt: "2026-08-13T00:00:00.000Z",
        ref: "main",
        ...(resolvedCommit ? { resolvedCommit } : {}),
      },
    },
  });
}

describe("global skill store", () => {
  it("shares a locked skill across projects and leaves independent materializations", async () => {
    const firstRoot = path.join(root, "first");
    const secondRoot = path.join(root, "second");
    await Promise.all([seedLock(firstRoot), seedLock(secondRoot)]);
    const fetch = vi.fn(async (_source, options) => {
      expect(options?.ref).toBe("deadbeef");
      return { path: checkout, ref: "deadbeef", commit: "deadbeef" };
    });

    const first = await createSkillSteps(CONFIG, context(firstRoot, fetch));
    const firstResult = await runSkillPipeline(
      CONFIG.skills?.sources ?? {},
      first.steps,
      createLogger({ quiet: true }),
    );
    await first.flush();

    const noNetwork = vi.fn(async () => {
      throw new Error("network should not be used");
    });
    const second = await createSkillSteps(CONFIG, context(secondRoot, noNetwork));
    const secondResult = await runSkillPipeline(
      CONFIG.skills?.sources ?? {},
      second.steps,
      createLogger({ quiet: true }),
    );
    await second.flush();

    expect(fetch).toHaveBeenCalledOnce();
    expect(noNetwork).not.toHaveBeenCalled();
    expect(firstResult.progress).toMatchObject({ reused: 0, fetched: 1 });
    expect(secondResult.progress).toMatchObject({ reused: 1, fetched: 0 });

    await fs.rm(storeDir, { recursive: true, force: true });
    await expect(
      fs.readFile(path.join(firstRoot, ".agnos", "skills", "tool", "SKILL.md"), "utf8"),
    ).resolves.toBe("# Shared\n");
    await expect(
      fs.readFile(path.join(secondRoot, ".agnos", "skills", "tool", "SKILL.md"), "utf8"),
    ).resolves.toBe("# Shared\n");
  });

  it("promotes and removes a valid legacy project cache", async () => {
    const projectRoot = path.join(root, "legacy");
    await seedLock(projectRoot);
    const legacy = path.join(projectRoot, ".agnos", "cache", "skills", hash);
    await fs.cp(path.join(checkout, "skills", "tool"), legacy, { recursive: true });
    const installed = path.join(projectRoot, ".agnos", "skills", "tool");
    await fs.mkdir(path.dirname(installed), { recursive: true });
    await fs.symlink(legacy, installed, process.platform === "win32" ? "junction" : "dir");
    const fetch = vi.fn(async () => {
      throw new Error("legacy migration should not fetch");
    });

    const handle = await createSkillSteps(CONFIG, context(projectRoot, fetch));
    await runSkillPipeline(
      CONFIG.skills?.sources ?? {},
      handle.steps,
      createLogger({ quiet: true }),
    );
    await handle.flush();

    expect(fetch).not.toHaveBeenCalled();
    expect((await fs.lstat(installed)).isSymbolicLink()).toBe(false);
    await expect(fs.access(path.join(projectRoot, ".agnos", "cache"))).rejects.toThrow();
    await expect(
      fs.access(path.join(storeDir, "skills", hash, "SKILL.md")),
    ).resolves.toBeUndefined();
  });

  it("fetches and backfills a matching legacy lock entry without a commit", async () => {
    const projectRoot = path.join(root, "legacy-lock");
    await seedLock(projectRoot, null);
    const fetch = vi.fn(async (_source, options) => {
      expect(options?.ref).toBe("main");
      return { path: checkout, ref: "main", commit: "deadbeef" };
    });
    const ctx = context(projectRoot, fetch);

    const handle = await createSkillSteps(CONFIG, ctx);
    const result = await runSkillPipeline(CONFIG.skills?.sources ?? {}, handle.steps, ctx.logger);
    await handle.flush();

    const lock = JSON.parse(await fs.readFile(path.join(projectRoot, "agnos.lock.json"), "utf8"));
    expect(fetch).toHaveBeenCalledOnce();
    expect(result.installed).toEqual(["tool"]);
    expect(lock.skills[COMPOSITE].resolvedCommit).toBe("deadbeef");
  });

  it("rejects and refetches a corrupt global entry", async () => {
    const projectRoot = path.join(root, "corrupt-store");
    await seedLock(projectRoot);
    const stored = path.join(storeDir, "skills", hash);
    await fs.mkdir(stored, { recursive: true });
    await fs.writeFile(path.join(stored, "SKILL.md"), "# Corrupt\n");
    const fetch = vi.fn(async () => ({ path: checkout, ref: "deadbeef", commit: "deadbeef" }));
    const ctx = context(projectRoot, fetch);

    const handle = await createSkillSteps(CONFIG, ctx);
    await runSkillPipeline(CONFIG.skills?.sources ?? {}, handle.steps, ctx.logger);
    await handle.flush();

    expect(fetch).toHaveBeenCalledOnce();
    expect(await hashSkillDir(stored)).toBe(hash);
  });

  it("removes an unreferenced legacy cache when a declared source is not pinned", async () => {
    const projectRoot = path.join(root, "unpinned-legacy");
    const legacy = path.join(projectRoot, ".agnos", "cache", "skills", "unreferenced");
    await fs.mkdir(legacy, { recursive: true });
    await fs.writeFile(path.join(legacy, "SKILL.md"), "# Unreferenced\n");
    const fetch = vi.fn(async () => {
      throw new Error("offline");
    });
    const handle = await createSkillSteps(CONFIG, context(projectRoot, fetch));

    await runSkillPipeline(
      CONFIG.skills?.sources ?? {},
      handle.steps,
      createLogger({ quiet: true }),
    );
    await handle.flush();

    await expect(fs.access(path.join(projectRoot, ".agnos", "cache"))).rejects.toThrow();
  });

  it("retains an unusable legacy cache when migration cannot finish", async () => {
    const projectRoot = path.join(root, "failed-legacy");
    await seedLock(projectRoot);
    const legacy = path.join(projectRoot, ".agnos", "cache", "skills", hash);
    await fs.mkdir(legacy, { recursive: true });
    await fs.writeFile(path.join(legacy, "SKILL.md"), "# Corrupt\n");
    const fetch = vi.fn(async () => {
      throw new Error("offline");
    });
    const ctx = context(projectRoot, fetch);
    const handle = await createSkillSteps(CONFIG, ctx);

    const result = await runSkillPipeline(CONFIG.skills?.sources ?? {}, handle.steps, ctx.logger);
    await handle.flush();

    expect(result.buckets.moved).toEqual(["tool"]);
    await expect(fs.access(path.join(projectRoot, ".agnos", "cache"))).resolves.toBeUndefined();
  });
});
