import { describe, it, expect } from "vitest";
import {
  agentRefSchema,
  agnosConfigSchema,
  docsConfigSchema,
  hookEntrySchema,
  hooksConfigSchema,
  lockFileSchema,
  mcpDeclarationSchema,
  rulesDeclarationSchema,
  skillSourcesSchema,
  skillsConfigSchema,
  skillLockEntrySchema,
} from "../../src/core/schema.js";

describe("schemas", () => {
  it("agentRefSchema accepts string ids and rejects objects", () => {
    expect(agentRefSchema.parse("claude-code")).toBe("claude-code");
    expect(agentRefSchema.parse("@me/agnos-agent-zed")).toBe("@me/agnos-agent-zed");
    expect(() => agentRefSchema.parse({ id: "zed", package: "@me/agnos-agent-zed" })).toThrow();
  });

  it("rulesDeclarationSchema defaults files to an empty map", () => {
    expect(rulesDeclarationSchema.parse({})).toEqual({ files: {} });
  });

  it("rulesDeclarationSchema accepts a canonical → injectables map", () => {
    const parsed = rulesDeclarationSchema.parse({
      files: {
        "./AGENTS.md": ["./.docs/index.md", "./fragments/security.md"],
        "./api/AGENTS.md": [],
      },
    });
    expect(parsed.files["./AGENTS.md"]).toEqual(["./.docs/index.md", "./fragments/security.md"]);
    expect(parsed.files["./api/AGENTS.md"]).toEqual([]);
  });

  it("docsConfigSchema defaults root to .docs and accepts metadata", () => {
    expect(docsConfigSchema.parse({})).toEqual({ root: ".docs" });
    const parsed = docsConfigSchema.parse({ root: "documentation", metadata: { owner: "team" } });
    expect(parsed.root).toBe("documentation");
    expect(parsed.metadata?.["owner"]).toBe("team");
  });

  it("hookEntrySchema accepts a valid command hook and rejects unknown events / extra keys", () => {
    expect(
      hookEntrySchema.parse({
        event: "PreToolUse",
        matcher: "git",
        type: "command",
        command: "echo hi",
        message: "running git guard",
      }),
    ).toBeDefined();
    // unknown event
    expect(() => hookEntrySchema.parse({ event: "Nope", type: "command", command: "x" })).toThrow();
    // strict: extra key rejected
    expect(() =>
      hookEntrySchema.parse({ event: "Stop", type: "command", command: "x", once: true }),
    ).toThrow();
  });

  it("hooksConfigSchema is a flat array of entries", () => {
    const parsed = hooksConfigSchema.parse([
      { event: "SessionStart", type: "command", command: "date" },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.event).toBe("SessionStart");
  });

  it("skillSourcesSchema accepts a name → composite-ref record", () => {
    const parsed = skillSourcesSchema.parse({ pdf: "github:foo/bar/skills/pdf" });
    expect(parsed["pdf"]).toBe("github:foo/bar/skills/pdf");
  });

  it("skillSourcesSchema rejects invalid names and multi-line refs", () => {
    expect(() => skillSourcesSchema.parse({ " bad ": "github:foo/bar/skills/pdf" })).toThrow();
    expect(() => skillSourcesSchema.parse({ pdf: "foo\nbar" })).toThrow();
  });

  it("skillsConfigSchema wraps route + sources into a single block", () => {
    const parsed = skillsConfigSchema.parse({
      route: ".agnos/skills",
      sources: { pdf: "github:foo/bar/skills/pdf" },
    });
    expect(parsed.route).toBe(".agnos/skills");
    expect(parsed.sources?.["pdf"]).toBe("github:foo/bar/skills/pdf");
  });

  it("mcpDeclarationSchema accepts minimal and full forms", () => {
    expect(mcpDeclarationSchema.parse({ name: "github" })).toBeDefined();
    expect(
      mcpDeclarationSchema.parse({
        name: "github",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" },
        transport: "stdio",
      }),
    ).toBeDefined();
  });

  it("agnosConfigSchema requires schemaVersion=1 and rejects older configs", () => {
    const parsed = agnosConfigSchema.parse({
      schemaVersion: 1,
      agents: ["claude-code"],
      rules: { files: { "./AGENTS.md": [] } },
    });
    expect(parsed.schemaVersion).toBe(1);
    // missing schemaVersion (old shape)
    expect(() => agnosConfigSchema.parse({ agents: ["claude-code"] })).toThrow();
  });

  it("agnosConfigSchema is lenient about unknown top-level keys", () => {
    const parsed = agnosConfigSchema.parse({
      schemaVersion: 1,
      prompts: [{ name: "user-domain", source: "file:./x" }],
    });
    expect(parsed["prompts"]).toBeDefined();
  });

  it("lockFileSchema requires version=1 + sha256 hashes and allows resolvedCommit/ref", () => {
    expect(
      lockFileSchema.parse({
        version: 1,
        skills: {
          "github:foo/bar/skills/pdf": {
            computedHash: "a".repeat(64),
            resolvedAt: "2026-05-18T00:00:00.000Z",
            resolvedCommit: "deadbeef",
            ref: "main",
          },
        },
      }),
    ).toBeDefined();
    expect(() => lockFileSchema.parse({ version: 2, skills: {} })).toThrow();
    expect(() =>
      skillLockEntrySchema.parse({ computedHash: "tooshort", resolvedAt: "x" }),
    ).toThrow();
  });
});
