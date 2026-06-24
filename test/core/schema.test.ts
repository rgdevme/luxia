import { describe, it, expect } from "vitest";
import {
  agentRefSchema,
  agnosConfigSchema,
  lockFileSchema,
  mcpDeclarationSchema,
  rulesDeclarationSchema,
  skillSourcesSchema,
  skillsConfigSchema,
  skillLockEntrySchema,
} from "../src/schema.js";

describe("schemas", () => {
  it("agentRefSchema accepts string ids and rejects objects", () => {
    expect(agentRefSchema.parse("claude-code")).toBe("claude-code");
    expect(agentRefSchema.parse("@me/agnos-agent-zed")).toBe("@me/agnos-agent-zed");
    expect(() => agentRefSchema.parse({ id: "zed", package: "@me/agnos-agent-zed" })).toThrow();
  });

  it("rulesDeclarationSchema applies defaults for an empty object", () => {
    expect(rulesDeclarationSchema.parse({})).toEqual({
      filename: "AGENTS.md",
      root: ".",
      dirs: [],
    });
  });

  it("rulesDeclarationSchema accepts a full nested declaration, including '..' dirs", () => {
    expect(
      rulesDeclarationSchema.parse({
        filename: "AGENTS.md",
        root: "./docs",
        dirs: ["./packages/a", "../shared/b"],
      }),
    ).toEqual({ filename: "AGENTS.md", root: "./docs", dirs: ["./packages/a", "../shared/b"] });
  });

  it("skillSourcesSchema accepts a name → composite-ref record", () => {
    const parsed = skillSourcesSchema.parse({
      pdf: "github:foo/bar/skills/pdf",
      "data-cleanup": "github:org/agents/packages/data/cleanup",
    });
    expect(parsed["pdf"]).toBe("github:foo/bar/skills/pdf");
  });

  it("skillSourcesSchema rejects invalid names", () => {
    expect(() => skillSourcesSchema.parse({ " bad ": "github:foo/bar/skills/pdf" })).toThrow();
  });

  it("skillSourcesSchema rejects multi-line refs", () => {
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

  it("agnosConfigSchema is lenient about unknown top-level keys", () => {
    const parsed = agnosConfigSchema.parse({
      agents: ["claude-code"],
      prompts: [{ name: "user-domain", source: "file:./x" }],
    });
    expect(parsed["prompts"]).toBeDefined();
  });

  it("lockFileSchema requires version=1 + sha256 hashes", () => {
    expect(
      lockFileSchema.parse({
        version: 1,
        skills: {
          "github:foo/bar/skills/pdf": {
            computedHash: "a".repeat(64),
            resolvedAt: "2026-05-18T00:00:00.000Z",
          },
        },
      }),
    ).toBeDefined();
    expect(() =>
      lockFileSchema.parse({
        version: 2,
        skills: {},
      }),
    ).toThrow();
    expect(() =>
      skillLockEntrySchema.parse({ computedHash: "tooshort", resolvedAt: "x" }),
    ).toThrow();
  });
});
