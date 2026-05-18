import { describe, it, expect } from "vitest";
import {
  agentRefSchema,
  agnosConfigSchema,
  lockFileSchema,
  mcpDeclarationSchema,
  rulesDeclarationSchema,
  skillsConfigSchema,
  skillLockEntrySchema,
} from "../src/schema.js";

describe("schemas", () => {
  it("agentRefSchema accepts string ids and rejects objects", () => {
    expect(agentRefSchema.parse("claude-code")).toBe("claude-code");
    expect(agentRefSchema.parse("@me/agnos-agent-zed")).toBe("@me/agnos-agent-zed");
    expect(() => agentRefSchema.parse({ id: "zed", package: "@me/agnos-agent-zed" })).toThrow();
  });

  it("rulesDeclarationSchema requires a source", () => {
    expect(() => rulesDeclarationSchema.parse({})).toThrow();
    expect(rulesDeclarationSchema.parse({ source: "./AGENTS.md" })).toEqual({
      source: "./AGENTS.md",
    });
  });

  it("skillsConfigSchema accepts a name → composite-ref record", () => {
    const parsed = skillsConfigSchema.parse({
      pdf: "github:foo/bar/skills/pdf",
      "data-cleanup": "github:org/agents/packages/data/cleanup",
    });
    expect(parsed["pdf"]).toBe("github:foo/bar/skills/pdf");
  });

  it("skillsConfigSchema rejects invalid names", () => {
    expect(() => skillsConfigSchema.parse({ " bad ": "github:foo/bar/skills/pdf" })).toThrow();
  });

  it("skillsConfigSchema rejects multi-line refs", () => {
    expect(() => skillsConfigSchema.parse({ pdf: "foo\nbar" })).toThrow();
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
