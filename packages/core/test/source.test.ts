import { describe, expect, it } from "vitest";
import path from "node:path";
import { parseCompositeSkillRef, parseSource } from "../src/source.js";

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

  it("parses https github URL with /tree/<branch>/<sub> suffix (captures subPath)", () => {
    const r = parseSource(
      "https://github.com/vercel-labs/agent-skills/tree/main/skills/foo",
      { projectRoot },
    );
    expect(r).toMatchObject({
      kind: "git",
      provider: "github",
      subPath: "skills/foo",
      canonical: "github:vercel-labs/agent-skills/skills/foo",
    });
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
