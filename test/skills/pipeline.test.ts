import { describe, it, expect, vi } from "vitest";
import { runSkillPipeline, type SkillSteps } from "../../src/domains/skills/pipeline.js";
import { mergeSkillSources } from "../../src/domains/skills/migrate.js";
import { createLogger } from "../../src/core/index.js";
import type { LogInput } from "../../src/core/index.js";

const logger = createLogger({ quiet: true });

/** Build steps where each named skill is forced into a given outcome. */
function steps(outcomes: Record<string, "ok" | "moved" | "changed">): SkillSteps {
  return {
    fetch: async (name) =>
      outcomes[name] === "moved" ? { ok: false } : { ok: true, src: `/src/${name}` },
    // The run pipeline never calls version (offline); it stays on the interface
    // for the explicit `agnos skills version` diagnostic.
    version: async () => true,
    integrity: async (name) => outcomes[name] !== "changed",
    install: vi.fn(async () => {}),
  };
}

describe("runSkillPipeline", () => {
  it("routes each skill into exactly one bucket and installs the clean ones", async () => {
    const sources = {
      a: { source: "repo", glob: "." },
      b: { source: "repo", glob: "." },
      d: { source: "repo", glob: "." },
    };
    const res = await runSkillPipeline(
      sources,
      steps({ a: "ok", b: "moved", d: "changed" }),
      logger,
    );
    expect(res.buckets.moved).toEqual(["b"]);
    expect(res.buckets.changed).toEqual(["d"]);
    expect(res.installed).toEqual(["a"]);
  });

  it("never calls the network version step (offline pipeline)", async () => {
    const versionSpy = vi.fn(async () => true);
    const s: SkillSteps = {
      fetch: async () => ({ ok: true, src: "/src/x" }),
      version: versionSpy,
      integrity: async () => true,
      install: vi.fn(async () => {}),
    };
    const res = await runSkillPipeline({ x: { source: "repo", glob: "." } }, s, logger);
    expect(res.installed).toEqual(["x"]);
    expect(versionSpy).not.toHaveBeenCalled();
  });

  it("threads the fetched ref into install", async () => {
    const installSpy = vi.fn(async () => {});
    const s: SkillSteps = {
      fetch: async () => ({ ok: true, src: "/src/x", ref: "main", commit: "deadbeef" }),
      version: async () => true,
      integrity: async () => true,
      install: installSpy,
    };
    await runSkillPipeline({ x: { source: "repo", glob: "." } }, s, logger);
    expect(installSpy).toHaveBeenCalledWith("x", "/src/x", "main", "deadbeef");
  });

  it("installs everything and reports no buckets when all skills are clean", async () => {
    const res = await runSkillPipeline(
      { a: { source: "repo", glob: "." }, b: { source: "repo", glob: "." } },
      steps({ a: "ok", b: "ok" }),
      logger,
    );
    expect(res.installed).toEqual(["a", "b"]);
    expect(res.buckets).toEqual({ moved: [], changed: [] });
  });

  it("reconciles independent skills concurrently while preserving declaration order", async () => {
    let active = 0;
    let peak = 0;
    const concurrentSteps: SkillSteps = {
      async fetch(name) {
        active += 1;
        peak = Math.max(peak, active);
        await Promise.resolve();
        active -= 1;
        return { ok: true, src: `/src/${name}` };
      },
      version: async () => true,
      integrity: async () => true,
      install: async () => {},
    };

    const res = await runSkillPipeline(
      {
        a: { source: "repo", glob: "." },
        b: { source: "repo", glob: "." },
        c: { source: "repo", glob: "." },
      },
      concurrentSteps,
      logger,
    );

    expect(peak).toBeGreaterThan(1);
    expect(res.installed).toEqual(["a", "b", "c"]);
  });

  it("reports percentage, total, reused, and fetched counters", async () => {
    const updates: LogInput[] = [];
    const stop = vi.fn();
    const progressLogger = {
      ...logger,
      progress(initial: LogInput) {
        updates.push(initial);
        return {
          update(next: LogInput) {
            updates.push(next);
          },
          stop,
        };
      },
    };
    const progressSteps: SkillSteps = {
      fetch: async (name) =>
        name === "missing"
          ? { ok: false }
          : {
              ok: true,
              src: `/src/${name}`,
              source: name === "cached" ? "reused" : "fetched",
            },
      version: async () => true,
      integrity: async () => true,
      install: async () => {},
    };

    const result = await runSkillPipeline(
      {
        cached: { source: "repo", glob: "a" },
        remote: { source: "repo", glob: "b" },
        missing: { source: "repo", glob: "c" },
      },
      progressSteps,
      progressLogger,
    );

    expect(result.progress).toEqual({ total: 3, completed: 3, reused: 1, fetched: 1 });
    expect(updates[0]).toEqual({
      message: "Installing skills 0%",
      status: "total 3 | reused 0 | fetched 0",
    });
    expect(updates.at(-1)).toEqual({
      message: "Installing skills 100%",
      status: "total 3 | reused 1 | fetched 1",
    });
    expect(stop).toHaveBeenCalledOnce();
  });
});

describe("mergeSkillSources (migrate policy)", () => {
  const existing = {
    pdf: { source: "github:org/repo", glob: "pdf" },
    csv: { source: "github:org/repo", glob: "csv" },
  };
  const discovered = {
    pdf: { source: "github:org/repo", glob: "pdf-NEW" },
    docx: { source: "github:org/repo", glob: "docx" },
  };

  it("missing: adds only absent names, leaves conflicts untouched", () => {
    const r = mergeSkillSources(existing, discovered, "missing");
    expect(r.added).toEqual(["docx"]);
    expect(r.overwritten).toEqual([]);
    expect(r.sources["pdf"]).toEqual({ source: "github:org/repo", glob: "pdf" }); // conflict left as-is
    expect(r.sources["docx"]).toEqual({ source: "github:org/repo", glob: "docx" });
  });

  it("force: overwrites conflicts and adds missing", () => {
    const r = mergeSkillSources(existing, discovered, "force");
    expect(r.overwritten).toEqual(["pdf"]);
    expect(r.added).toEqual(["docx"]);
    expect(r.sources["pdf"]).toEqual({ source: "github:org/repo", glob: "pdf-NEW" });
  });

  it("skip: aborts and changes nothing when any conflict exists", () => {
    const r = mergeSkillSources(existing, discovered, "skip");
    expect(r.aborted).toBe(true);
    expect(r.conflicts).toEqual(["pdf"]);
    expect(r.sources).toEqual(existing);
  });

  it("identical discovered source is a no-op (not a conflict)", () => {
    const r = mergeSkillSources(
      existing,
      { pdf: { source: "github:org/repo", glob: "pdf" } },
      "skip",
    );
    expect(r.aborted).toBe(false);
    expect(r.conflicts).toEqual([]);
  });
});
