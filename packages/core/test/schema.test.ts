import { describe, it, expect } from "vitest";
import {
  agentRefSchema,
  agnosConfigSchema,
  mcpDeclarationSchema,
  skillDeclarationSchema,
  rulesDeclarationSchema,
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

  it("skillDeclarationSchema enforces a name pattern", () => {
    expect(
      skillDeclarationSchema.parse({ name: "pdf", source: "github:foo/bar/pdf" }),
    ).toBeDefined();
    expect(() => skillDeclarationSchema.parse({ name: " bad name ", source: "x" })).toThrow();
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
});
