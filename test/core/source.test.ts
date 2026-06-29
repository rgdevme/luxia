import { describe, expect, it } from "vitest";
import path from "node:path";
import { parseCompositeSkillRef, parseSource } from "../../src/core/source.js";

const projectRoot = path.resolve("/tmp/agnos-test-root");

describe("parseSource", () => {
  it("parses bare owner/repo with default github provider", () => {
    const r = parseSource("vercel-labs/agent-skills", { projectRoot });
    expect(r).toMatchObject({
      kind: "git",
      provider: "github",
      owner: "vercel-labs",
      repo: "agent-skills",
      canonical: "github:vercel-labs/agent-skills",
    });
  });

  it("honors defaultProvider override", () => {
    const r = parseSource("owner/repo", { projectRoot, defaultProvider: "gitlab" });
    expect(r).toMatchObject({ provider: "gitlab", canonical: "gitlab:owner/repo" });
  });

  it("parses https github URL", () => {
    const r = parseSource("https://github.com/vercel-labs/agent-skills", { projectRoot });
    expect(r).toMatchObject({
      kind: "git",
      provider: "github",
      canonical: "github:vercel-labs/agent-skills",
    });
  });

  it("parses https github URL with /tree/<branch>/<sub> suffix (captures subPath + ref)", () => {
    const r = parseSource("https://github.com/vercel-labs/agent-skills/tree/main/skills/foo", {
      projectRoot,
    });
    expect(r).toMatchObject({
      kind: "git",
      provider: "github",
      subPath: "skills/foo",
      // A branch explicitly present in the URL is an explicit ref, so it's pinned.
      ref: "main",
      canonical: "github:vercel-labs/agent-skills/skills/foo#main",
    });
  });

  it("leaves ref unset (follow default branch) when no #ref is given", () => {
    const r = parseSource("vercel-labs/agent-skills", { projectRoot });
    expect(r).toMatchObject({ kind: "git", canonical: "github:vercel-labs/agent-skills" });
    expect(r).not.toHaveProperty("ref");
  });

  it("parses a trailing #ref on bare shorthand", () => {
    const r = parseSource("convex-dev/convex#develop", { projectRoot });
    expect(r).toMatchObject({
      kind: "git",
      owner: "convex-dev",
      repo: "convex",
      ref: "develop",
      canonical: "github:convex-dev/convex#develop",
    });
  });

  it("parses #ref alongside a sub-path (ref stays at the end)", () => {
    const r = parseSource("owner/repo/skills/pdf#v1.2.3", { projectRoot });
    expect(r).toMatchObject({
      kind: "git",
      subPath: "skills/pdf",
      ref: "v1.2.3",
      canonical: "github:owner/repo/skills/pdf#v1.2.3",
    });
  });

  it("parses #ref on the canonical provider form idempotently", () => {
    const r = parseSource("github:owner/repo#release/2026", { projectRoot });
    expect(r.ref).toBe("release/2026");
    expect(parseSource(r.canonical, { projectRoot }).canonical).toBe(r.canonical);
  });

  it("preserves an explicit #main (pins main, distinct from following default)", () => {
    const r = parseSource("owner/repo#main", { projectRoot });
    expect(r).toMatchObject({ ref: "main", canonical: "github:owner/repo#main" });
  });

  it("parses #ref on an https URL", () => {
    const r = parseSource("https://github.com/convex-dev/convex#develop", { projectRoot });
    expect(r).toMatchObject({ ref: "develop", canonical: "github:convex-dev/convex#develop" });
  });

  it("captures the ref from an https /tree/<branch> URL with no sub-path", () => {
    const r = parseSource("https://github.com/convex-dev/convex/tree/develop", { projectRoot });
    expect(r).toMatchObject({
      ref: "develop",
      canonical: "github:convex-dev/convex#develop",
    });
    expect(r).not.toHaveProperty("subPath");
  });

  it("captures both ref and sub-path from an https /tree/<branch>/<sub> URL", () => {
    const r = parseSource("https://github.com/owner/repo/tree/develop/skills/foo", { projectRoot });
    expect(r).toMatchObject({
      ref: "develop",
      subPath: "skills/foo",
      canonical: "github:owner/repo/skills/foo#develop",
    });
  });

  it("lets an explicit #ref override the /tree/<branch> ref", () => {
    const r = parseSource("https://github.com/owner/repo/tree/develop/skills/foo#hotfix", {
      projectRoot,
    });
    expect(r.ref).toBe("hotfix");
  });

  it("rejects an empty ref after #", () => {
    expect(() => parseSource("owner/repo#", { projectRoot })).toThrow(
      /must be followed by a git ref/,
    );
  });

  it("rejects a ref containing illegal characters", () => {
    expect(() => parseSource("owner/repo#bad ref", { projectRoot })).toThrow(/Invalid git ref/);
    expect(() => parseSource("owner/repo#a..b", { projectRoot })).toThrow(/Invalid git ref/);
  });

  it("parses bare shorthand with sub-path", () => {
    const r = parseSource("vercel-labs/agent-skills/skills/pdf", { projectRoot });
    expect(r).toMatchObject({
      kind: "git",
      owner: "vercel-labs",
      repo: "agent-skills",
      subPath: "skills/pdf",
      canonical: "github:vercel-labs/agent-skills/skills/pdf",
    });
  });

  it("parses canonical github:owner/repo/sub idempotently", () => {
    const r = parseSource("github:vercel-labs/agent-skills/skills/pdf", { projectRoot });
    expect(r.canonical).toBe("github:vercel-labs/agent-skills/skills/pdf");
  });

  it("parses https gitlab URL", () => {
    const r = parseSource("https://gitlab.com/owner/repo", { projectRoot });
    expect(r.canonical).toBe("gitlab:owner/repo");
  });

  it("parses https bitbucket URL", () => {
    const r = parseSource("https://bitbucket.org/team/repo", { projectRoot });
    expect(r.canonical).toBe("bitbucket:team/repo");
  });

  it("parses ssh git@github.com URL with .git suffix", () => {
    const r = parseSource("git@github.com:vercel-labs/agent-skills.git", { projectRoot });
    expect(r.canonical).toBe("github:vercel-labs/agent-skills");
  });

  it("parses ssh git@gitlab.com URL without .git suffix", () => {
    const r = parseSource("git@gitlab.com:owner/repo", { projectRoot });
    expect(r.canonical).toBe("gitlab:owner/repo");
  });

  it("parses canonical provider:owner/repo idempotently", () => {
    const r = parseSource("github:vercel-labs/agent-skills", { projectRoot });
    expect(r.canonical).toBe("github:vercel-labs/agent-skills");
  });

  it("parses relative local path", () => {
    const r = parseSource("./my-skills", { projectRoot });
    expect(r.kind).toBe("local");
    expect(r.canonical).toBe("file:./my-skills");
  });

  it("parses absolute local path inside project as relative", () => {
    const r = parseSource(path.join(projectRoot, "stuff"), { projectRoot });
    expect(r.kind).toBe("local");
    expect(r.canonical).toBe("file:./stuff");
  });

  it("parses absolute local path outside project as absolute", () => {
    const outside = path.resolve("/elsewhere/foo");
    const r = parseSource(outside, { projectRoot });
    expect(r.kind).toBe("local");
    expect(r.canonical.startsWith("file:")).toBe(true);
    expect(r.canonical).not.toBe("file:./elsewhere/foo");
  });

  it("rejects unsupported https host", () => {
    expect(() => parseSource("https://example.com/owner/repo", { projectRoot })).toThrow(
      /Unsupported git host/,
    );
  });

  it("rejects unsupported ssh host", () => {
    expect(() => parseSource("git@example.com:owner/repo.git", { projectRoot })).toThrow(
      /Unsupported git host/,
    );
  });

  it("rejects garbage input with usage guidance", () => {
    expect(() => parseSource("just-a-word", { projectRoot })).toThrow(/Cannot parse source/);
  });

  it("rejects empty input", () => {
    expect(() => parseSource("", { projectRoot })).toThrow(/empty/);
  });

  it("rejects sub-paths containing ..", () => {
    expect(() => parseSource("owner/repo/foo/../etc", { projectRoot })).toThrow(/must not contain/);
  });
});

describe("parseCompositeSkillRef", () => {
  it("accepts a git ref with sub-path", () => {
    const r = parseCompositeSkillRef("github:vercel-labs/agent-skills/skills/pdf", {
      projectRoot,
    });
    expect(r.subPath).toBe("skills/pdf");
    expect(r.composite).toBe("github:vercel-labs/agent-skills/skills/pdf");
  });

  it("rejects a git ref without a sub-path (must point at a concrete skill)", () => {
    expect(() =>
      parseCompositeSkillRef("github:vercel-labs/agent-skills", { projectRoot }),
    ).toThrow(/missing in-repo path/);
  });

  it("accepts a file: ref pointing at a skill directory", () => {
    const r = parseCompositeSkillRef("file:./local/skills/pdf", { projectRoot });
    expect(r.source.kind).toBe("local");
    expect(r.composite).toBe("file:./local/skills/pdf");
  });
});
