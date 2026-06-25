import { describe, it, expect, vi } from "vitest";
import { runSkillPipeline, type SkillSteps } from "../../src/domains/skills/pipeline.js";
import { mergeSkillSources } from "../../src/domains/skills/migrate.js";
import { createLogger } from "../../src/core/index.js";

const logger = createLogger({ quiet: true });

/** Build steps where each named skill is forced into a given outcome. */
function steps(outcomes: Record<string, "ok" | "moved" | "outdated" | "changed">): SkillSteps {
  return {
    fetch: async (name) =>
      outcomes[name] === "moved" ? { ok: false } : { ok: true, src: `/src/${name}` },
    version: async (name) => outcomes[name] !== "outdated",
    integrity: async (name) => outcomes[name] !== "changed",
    install: vi.fn(async () => {}),
  };
}

describe("runSkillPipeline", () => {
  it("routes each skill into exactly one bucket and installs the clean ones", async () => {
    const sources = { a: "r", b: "r", c: "r", d: "r" };
    const res = await runSkillPipeline(
      sources,
      steps({ a: "ok", b: "moved", c: "outdated", d: "changed" }),
      logger,
    );
    expect(res.buckets.moved).toEqual(["b"]);
    expect(res.buckets.outdated).toEqual(["c"]);
    expect(res.buckets.changed).toEqual(["d"]);
    expect(res.installed).toEqual(["a"]);
  });

  it("short-circuits in precedence order: an outdated+changed skill reports outdated", async () => {
    // version runs before integrity, so "outdated" wins and integrity never runs.
    const integritySpy = vi.fn(async () => false);
    const s: SkillSteps = {
      fetch: async () => ({ ok: true, src: "/src/x" }),
      version: async () => false, // outdated
      integrity: integritySpy,
      install: vi.fn(async () => {}),
    };
    const res = await runSkillPipeline({ x: "r" }, s, logger);
    expect(res.buckets.outdated).toEqual(["x"]);
    expect(res.buckets.changed).toEqual([]);
    expect(integritySpy).not.toHaveBeenCalled();
  });

  it("installs everything and reports no buckets when all skills are clean", async () => {
    const res = await runSkillPipeline({ a: "r", b: "r" }, steps({ a: "ok", b: "ok" }), logger);
    expect(res.installed).toEqual(["a", "b"]);
    expect(res.buckets).toEqual({ moved: [], changed: [], outdated: [] });
  });
});

describe("mergeSkillSources (migrate policy)", () => {
  const existing = { pdf: "github:org/repo/pdf", csv: "github:org/repo/csv" };
  const discovered = { pdf: "github:org/repo/pdf-NEW", docx: "github:org/repo/docx" };

  it("missing: adds only absent names, leaves conflicts untouched", () => {
    const r = mergeSkillSources(existing, discovered, "missing");
    expect(r.added).toEqual(["docx"]);
    expect(r.overwritten).toEqual([]);
    expect(r.sources["pdf"]).toBe("github:org/repo/pdf"); // conflict left as-is
    expect(r.sources["docx"]).toBe("github:org/repo/docx");
  });

  it("force: overwrites conflicts and adds missing", () => {
    const r = mergeSkillSources(existing, discovered, "force");
    expect(r.overwritten).toEqual(["pdf"]);
    expect(r.added).toEqual(["docx"]);
    expect(r.sources["pdf"]).toBe("github:org/repo/pdf-NEW");
  });

  it("skip: aborts and changes nothing when any conflict exists", () => {
    const r = mergeSkillSources(existing, discovered, "skip");
    expect(r.aborted).toBe(true);
    expect(r.conflicts).toEqual(["pdf"]);
    expect(r.sources).toEqual(existing);
  });

  it("identical discovered source is a no-op (not a conflict)", () => {
    const r = mergeSkillSources(existing, { pdf: "github:org/repo/pdf" }, "skip");
    expect(r.aborted).toBe(false);
    expect(r.conflicts).toEqual([]);
  });
});
