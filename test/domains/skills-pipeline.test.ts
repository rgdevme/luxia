import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type {
  AgnosConfig,
  RepositoryTrackInfo,
  RepositoryTracker,
  ResolveContext,
} from "../../src/core/index.js";
import { createLogger, hashSkillDir } from "../../src/core/index.js";
import {
  createSkillSteps,
  resolveSkillTargets,
  updateSkills,
} from "../../src/domains/skills/steps.js";
import { runSkillPipeline } from "../../src/domains/skills/pipeline.js";

let tmp: string;
let tracker: RepositoryTracker;
let trackedInfo: RepositoryTrackInfo;

const request = { source: "github:owner/repo", branch: "main", glob: "skills/tool" };

function ctxFor(config: AgnosConfig = {} as AgnosConfig): ResolveContext {
  const logger = createLogger({ quiet: true });
  return {
    config,
    agnosRoot: path.join(tmp, ".agnos"),
    projectRoot: tmp,
    storeDir: path.join(tmp, "store"),
    configPath: path.join(tmp, "agnos.json"),
    logger,
    fetcher: {
      fetch: async (source: { absolutePath?: string }) => ({
        path: source.absolutePath ?? path.join(tmp, "source"),
      }),
      cleanup: async () => {},
    },
    repositoryTracker: tracker,
    linker: {} as never,
    dryRun: false,
  };
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-skills-"));
  const checkout = path.join(tmp, "checkout");
  const selected = path.join(checkout, "skills", "tool");
  await fs.mkdir(selected, { recursive: true });
  await fs.writeFile(path.join(selected, "SKILL.md"), "# Tool\n");
  await fs.writeFile(path.join(selected, "helper.txt"), "support\n");
  trackedInfo = {
    trackingId: "tracking-id",
    repositoryId: "repository-id",
    request,
    branch: "main",
    commit: "a".repeat(40),
    checkoutPath: checkout,
    entries: [{ path: "skills/tool", absolutePath: selected, kind: "directory" }],
  };
  tracker = {
    add: vi.fn(async () => trackedInfo),
    update: vi.fn(async () => trackedInfo),
    shouldUpdate: vi.fn(async () => false),
    remove: vi.fn(async () => {}),
    listRegistrations: vi.fn(async () => [{ trackingId: trackedInfo.trackingId, request }]),
  };
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("skills tracking and selection", () => {
  it("warns about incompatible metadata while still installing the skill", async () => {
    const skillFile = path.join(trackedInfo.entries[0]!.absolutePath, "SKILL.md");
    await fs.writeFile(skillFile, "# Missing frontmatter\n");
    const config: AgnosConfig = {
      schemaVersion: 1,
      harness: ["codex"],
      skills: { sources: { tool: request } },
    };
    const ctx = ctxFor(config);
    const warn = vi.spyOn(ctx.logger, "warn");
    const handle = await createSkillSteps(config, ctx);
    const result = await runSkillPipeline(config.skills?.sources ?? {}, handle.steps, ctx.logger);
    await handle.flush();

    expect(result.installed).toEqual(["tool"]);
    expect(warn).toHaveBeenCalled();
    expect(tracker.add).toHaveBeenCalledOnce();
  });

  it("acquires Git skills through the tracker and records observed lock metadata without project materialization", async () => {
    const config: AgnosConfig = { schemaVersion: 1, skills: { sources: { tool: request } } };
    const ctx = ctxFor(config);
    const handle = await createSkillSteps(config, ctx);
    const result = await runSkillPipeline(config.skills?.sources ?? {}, handle.steps, ctx.logger);
    await handle.flush();

    expect(result.installed).toEqual(["tool"]);
    expect(tracker.add).toHaveBeenCalledOnce();
    expect(await fs.readFile(path.join(tmp, "agnos.lock.json"), "utf8")).toContain(
      trackedInfo.commit,
    );
    await expect(fs.access(path.join(tmp, ".agnos", "skills", "tool"))).rejects.toThrow();
  });

  it("selects a local authored skill over a same-named tracked skill", async () => {
    const local = path.join(tmp, ".agnos", "skills", "tool");
    await fs.mkdir(local, { recursive: true });
    await fs.writeFile(path.join(local, "SKILL.md"), "# Local\n");
    const config: AgnosConfig = { schemaVersion: 1, skills: { sources: { tool: request } } };
    const targets = await resolveSkillTargets(config, ctxFor(config));
    expect(targets.tool).toBe(local);
  });

  it("keeps declared skill resolution catalog-backed and reports upstream freshness", async () => {
    const config: AgnosConfig = { schemaVersion: 1, skills: { sources: { tool: request } } };
    const ctx = ctxFor(config);
    const handle = await createSkillSteps(config, ctx);
    const fetched = await handle.steps.fetch("tool", request);
    expect(fetched.ok).toBe(true);
    expect(await handle.steps.version("tool", fetched.src ?? "")).toBe(true);
    expect(tracker.listRegistrations).toHaveBeenCalledWith({
      projectId: path.resolve(ctx.configPath),
      domain: "skills",
      name: "tool",
    });
  });

  it("updates live tracked skills and preserves the lock structure", async () => {
    const config: AgnosConfig = { schemaVersion: 1, skills: { sources: { tool: request } } };
    const updated = await updateSkills([], config, ctxFor(config));
    expect(updated).toEqual(["tool"]);
    expect(tracker.update).toHaveBeenCalledWith(trackedInfo.trackingId);
    const lock = JSON.parse(await fs.readFile(path.join(tmp, "agnos.lock.json"), "utf8")) as {
      version: number;
      skills: Record<string, { computedHash: string }>;
    };
    expect(lock.version).toBe(1);
    expect(lock.skills[JSON.stringify(request)]?.computedHash).toBe(
      await hashSkillDir(trackedInfo.entries[0]!.absolutePath),
    );
  });
});
