import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { AgnosConfig, CommandContext, ResolveContext } from "../../src/core/index.js";
import { createLogger } from "../../src/core/index.js";
import { createSkillSteps, updateSkills } from "../../src/domains/skills/steps.js";
import { runSkillPipeline } from "../../src/domains/skills/pipeline.js";
import skillsDomain from "../../src/domains/skills/index.js";

let tmp: string;

// A fetcher that resolves a local `file:` source to its own directory (no network).
const ctxFor = (): ResolveContext => ({
  agnosRoot: tmp,
  projectRoot: tmp,
  cacheDir: path.join(tmp, ".agnos", "cache"),
  configPath: path.join(tmp, "agnos.json"),
  statePath: path.join(tmp, ".agnos", "state.json"),
  logger: createLogger({ quiet: true }),
  fetcher: {
    fetch: async (source: { absolutePath?: string }) => ({ path: source.absolutePath ?? tmp }),
  } as never,
  linker: {} as never,
  dryRun: false,
});

const cfg = (): AgnosConfig => ({
  schemaVersion: 1,
  skills: { route: ".agnos/skills", sources: { mytool: "file:./skill-src" } },
});
const SOURCES = { mytool: "file:./skill-src" };
const fetchSrc = async (steps: Awaited<ReturnType<typeof createSkillSteps>>["steps"]) => {
  const f = await steps.fetch("mytool", "file:./skill-src");
  return f.src!;
};
const installed = path.join(".agnos", "skills", "mytool", "SKILL.md");

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-skills-"));
  await fs.mkdir(path.join(tmp, "skill-src"), { recursive: true });
  await fs.writeFile(path.join(tmp, "skill-src", "SKILL.md"), "# My Tool\n");
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("skills prep pipeline (steps)", () => {
  it("fetch resolves a file: skill and reports moved when absent", async () => {
    const { steps } = await createSkillSteps(cfg(), ctxFor());
    expect((await steps.fetch("mytool", "file:./skill-src")).ok).toBe(true);
    expect((await steps.fetch("mytool", "file:./nope")).ok).toBe(false);
  });

  it("install copies + pins the lock; integrity then matches; version has no baseline", async () => {
    const ctx = ctxFor();
    const h = await createSkillSteps(cfg(), ctx);
    const res = await runSkillPipeline(SOURCES, h.steps, ctx.logger);
    await h.flush();
    expect(res.installed).toEqual(["mytool"]);
    expect(await fs.readFile(path.join(tmp, installed), "utf8")).toContain("My Tool");
    const lock = JSON.parse(await fs.readFile(path.join(tmp, "agnos.lock.json"), "utf8"));
    expect(Object.keys(lock.skills)).toEqual(["file:./skill-src"]);

    const h2 = await createSkillSteps(cfg(), ctx);
    const src = await fetchSrc(h2.steps);
    expect(await h2.steps.integrity("mytool", src)).toBe(true);
    expect(await h2.steps.version("mytool", src)).toBe(true); // no resolvedCommit baseline
  });

  it("integrity reports changed when content drifts from the lock", async () => {
    const ctx = ctxFor();
    const h = await createSkillSteps(cfg(), ctx);
    await runSkillPipeline(SOURCES, h.steps, ctx.logger);
    await h.flush();
    await fs.writeFile(path.join(tmp, "skill-src", "SKILL.md"), "# Changed\n");
    const h2 = await createSkillSteps(cfg(), ctx);
    expect(await h2.steps.integrity("mytool", await fetchSrc(h2.steps))).toBe(false);
  });

  it("updateSkills re-pins drifted content (integrity matches again)", async () => {
    const ctx = ctxFor();
    const h = await createSkillSteps(cfg(), ctx);
    await runSkillPipeline(SOURCES, h.steps, ctx.logger);
    await h.flush();
    await fs.writeFile(path.join(tmp, "skill-src", "SKILL.md"), "# Changed\n");
    expect(await updateSkills([], cfg(), ctx)).toEqual(["mytool"]);
    const h2 = await createSkillSteps(cfg(), ctx);
    expect(await h2.steps.integrity("mytool", await fetchSrc(h2.steps))).toBe(true);
    expect(await fs.readFile(path.join(tmp, installed), "utf8")).toContain("Changed");
  });
});

describe("skills migrate command", () => {
  it("imports name → ref from a lock file", async () => {
    await fs.writeFile(path.join(tmp, "agnos.json"), JSON.stringify({ schemaVersion: 1 }));
    await fs.writeFile(
      path.join(tmp, "skills-lock.json"),
      JSON.stringify({ pdf: "github:o/r/skills/pdf" }),
    );
    const ctx: CommandContext = {
      ...ctxFor(),
      args: [],
      flags: {
        dry: false,
        once: true,
        quiet: true,
        help: false,
        init: false,
        yes: true,
        missing: true,
      },
    };
    await skillsDomain.commands!["migrate"]!.run(ctx);
    const out = JSON.parse(await fs.readFile(path.join(tmp, "agnos.json"), "utf8"));
    expect(out.skills.sources).toEqual({ pdf: "github:o/r/skills/pdf" });
  });
});
