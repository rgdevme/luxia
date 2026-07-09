import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type {
  AgnosConfig,
  CommandContext,
  LogParts,
  ResolveContext,
} from "../../src/core/index.js";
import { createLogger } from "../../src/core/index.js";
import { createSkillSteps, pruneSkills, updateSkills } from "../../src/domains/skills/steps.js";
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
  if (!f.src) throw new Error("expected mytool fetch to resolve");
  return f.src;
};
const installed = path.join(".agnos", "skills", "mytool", "SKILL.md");

function resolveSkillsDomainRun(): NonNullable<typeof skillsDomain.run> {
  const run = skillsDomain.run;
  if (!run) throw new Error("skills domain run is not registered");
  return run;
}

function resolveSkillsCommand(name: string) {
  const command = skillsDomain.commands?.[name];
  if (!command) throw new Error(`skills command "${name}" is not registered`);
  return command;
}

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

  it("pruneSkills removes undeclared materialized skills and stale lock entries", async () => {
    const ctx = ctxFor();
    const h = await createSkillSteps(cfg(), ctx);
    await runSkillPipeline(SOURCES, h.steps, ctx.logger);
    await h.flush();
    await fs.mkdir(path.join(tmp, ".agnos", "skills", "oldtool"), { recursive: true });
    await fs.writeFile(path.join(tmp, ".agnos", "skills", "oldtool", "SKILL.md"), "# Old\n");
    await fs.writeFile(path.join(tmp, ".agnos", "skills", "note.txt"), "keep me");

    const lockPath = path.join(tmp, "agnos.lock.json");
    const lock = JSON.parse(await fs.readFile(lockPath, "utf8")) as {
      skills: Record<string, unknown>;
    };
    lock.skills["file:./old-src"] = {
      computedHash: "a".repeat(64),
      resolvedAt: "2026-07-09T00:00:00.000Z",
    };
    await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

    const pruned = await pruneSkills(cfg(), ctx);

    expect(pruned.removed).toEqual(["oldtool"]);
    expect(pruned.unpinned).toEqual(["file:./old-src"]);
    await expect(fs.access(path.join(tmp, ".agnos", "skills", "oldtool"))).rejects.toThrow();
    await expect(
      fs.access(path.join(tmp, ".agnos", "skills", "note.txt")),
    ).resolves.toBeUndefined();
    const nextLock = JSON.parse(await fs.readFile(lockPath, "utf8")) as {
      skills: Record<string, unknown>;
    };
    expect(Object.keys(nextLock.skills)).toEqual(["file:./skill-src"]);
  });
});

describe("skills domain run", () => {
  it("reports drifted skills as 'changed' (aggregated) without throwing", async () => {
    await fs.writeFile(path.join(tmp, "agnos.json"), JSON.stringify(cfg()));
    // pin the skill, then drift its content
    const pin = ctxFor();
    const h = await createSkillSteps(cfg(), pin);
    await runSkillPipeline(SOURCES, h.steps, pin.logger);
    await h.flush();
    await fs.writeFile(path.join(tmp, "skill-src", "SKILL.md"), "# Changed\n");

    const warns: LogParts[] = [];
    // Real logger (so `info`'s `waitFor` runs the pipeline and is awaited); only
    // `warn` is overridden to capture the aggregated drift report.
    const ctx = {
      ...ctxFor(),
      logger: { ...createLogger({ quiet: true }), warn: (m: LogParts) => warns.push(m) },
      flags: { dry: false, once: true, quiet: false, help: false, init: false, yes: true },
    };
    await resolveSkillsDomainRun()(
      { dry: false, once: true, quiet: false, interactive: false },
      ctx as never,
    );

    expect(warns).toHaveLength(1);
    const firstWarn = warns[0];
    if (!firstWarn) throw new Error("expected skills warning");
    const { message, extra } = firstWarn;
    expect(message).toContain("skills need updating");
    expect(message).toContain("1 changed");
    expect(extra).toBe("run: agnos skills update");
  });

  it("prunes stale materialized skills during the normal domain run", async () => {
    await fs.writeFile(path.join(tmp, "agnos.json"), JSON.stringify(cfg()));
    await fs.mkdir(path.join(tmp, ".agnos", "skills", "oldtool"), { recursive: true });
    await fs.writeFile(path.join(tmp, ".agnos", "skills", "oldtool", "SKILL.md"), "# Old\n");
    const ctx = {
      ...ctxFor(),
      flags: { dry: false, once: true, quiet: false, help: false, init: false, yes: true },
    };

    await resolveSkillsDomainRun()(
      { dry: false, once: true, quiet: false, interactive: false },
      ctx as never,
    );

    await expect(fs.access(path.join(tmp, ".agnos", "skills", "oldtool"))).rejects.toThrow();
    await expect(fs.access(path.join(tmp, installed))).resolves.toBeUndefined();
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
    await resolveSkillsCommand("migrate").run(ctx);
    const out = JSON.parse(await fs.readFile(path.join(tmp, "agnos.json"), "utf8"));
    expect(out.skills.sources).toEqual({ pdf: "github:o/r/skills/pdf" });
  });
});
