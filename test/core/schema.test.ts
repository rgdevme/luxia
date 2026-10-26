import { describe, it, expect } from "vitest";
import {
  harnessRefSchema,
  agnosConfigSchema,
  docFrontmatterSchema,
  docsConfigSchema,
  lockFileSchema,
  mcpDeclarationSchema,
  rulesDeclarationSchema,
  referencesConfigSchema,
  skillSourcesSchema,
  skillsConfigSchema,
  skillLockEntrySchema,
} from "../../src/core/schema.js";

describe("schemas", () => {
  it("harnessRefSchema accepts string ids and rejects objects", () => {
    expect(harnessRefSchema.parse("claude-code")).toBe("claude-code");
    expect(harnessRefSchema.parse("@me/agnos-agent-zed")).toBe("@me/agnos-agent-zed");
    expect(() => harnessRefSchema.parse({ id: "zed", package: "@me/agnos-agent-zed" })).toThrow();
  });

  it("rulesDeclarationSchema defaults fragments to an empty map", () => {
    expect(rulesDeclarationSchema.parse({})).toEqual({ fragments: {} });
  });

  it("rulesDeclarationSchema accepts generated artifact source maps", () => {
    const parsed = rulesDeclarationSchema.parse({
      fragments: {
        "./AGENTS.md": ["./.agnos/docs/index.md", "./fragments/security.md"],
        "./api/AGENTS.md": [],
      },
    });
    expect(parsed.fragments["./AGENTS.md"]).toEqual([
      "./.agnos/docs/index.md",
      "./fragments/security.md",
    ]);
    expect(parsed.fragments["./api/AGENTS.md"]).toEqual([]);
  });

  it("rulesDeclarationSchema accepts a bootstrap directory", () => {
    expect(rulesDeclarationSchema.parse({ dir: ".docs/.rules" })).toEqual({
      dir: ".docs/.rules",
      fragments: {},
    });
    expect(() => rulesDeclarationSchema.parse({ files: {} })).toThrow();
  });

  it("docsConfigSchema defaults dir to .agnos/docs", () => {
    expect(docsConfigSchema.parse({})).toEqual({ dir: ".agnos/docs", ignore: [] });
    const parsed = docsConfigSchema.parse({ dir: "documentation" });
    expect(parsed.dir).toBe("documentation");
    expect(parsed.ignore).toEqual([]);
    expect(() => docsConfigSchema.parse({ root: "documentation" })).toThrow();
  });

  it("uses dir for skills and references", () => {
    expect(skillsConfigSchema.parse({ dir: ".agnos/skills" }).dir).toBe(".agnos/skills");
    expect(() => skillsConfigSchema.parse({ localDir: ".agnos/skills" })).toThrow();
    expect(referencesConfigSchema.parse({}).dir).toBe(".agnos/references");
    expect(() => referencesConfigSchema.parse({ route: ".agnos/references" })).toThrow();
  });

  it("docsConfigSchema accepts ignore glob patterns", () => {
    expect(docsConfigSchema.parse({ ignore: ["drafts/**", "**/*.tmp.md"] }).ignore).toEqual([
      "drafts/**",
      "**/*.tmp.md",
    ]);
  });

  it("docFrontmatterSchema requires type/title/description/timestamp and allows empty resource/tags", () => {
    const ok = docFrontmatterSchema.safeParse({
      type: "Technical Doc",
      title: "Auth",
      description: "How auth works",
      resource: "",
      tags: [],
      timestamp: "2026-06-30T00:00:00Z",
    });
    expect(ok.success).toBe(true);

    // Missing required fields and absent resource/tags keys all fail.
    expect(docFrontmatterSchema.safeParse({ title: "Only title" }).success).toBe(false);
    expect(
      docFrontmatterSchema.safeParse({
        type: "Doc",
        title: "No timestamp",
        description: "d",
        resource: "",
        tags: [],
      }).success,
    ).toBe(false);

    // Unknown keys are tolerated (OKF passthrough).
    const extra = docFrontmatterSchema.safeParse({
      type: "Doc",
      title: "T",
      description: "d",
      resource: "",
      tags: [],
      timestamp: "2026-06-30T00:00:00Z",
      owner: "team",
    });
    expect(extra.success).toBe(true);
  });

  it("skillSourcesSchema accepts normalized repository requests", () => {
    const parsed = skillSourcesSchema.parse({
      pdf: { source: "github:foo/bar", glob: "skills/pdf" },
    });
    expect(parsed["pdf"]).toEqual({ source: "github:foo/bar", glob: "skills/pdf" });
  });

  it("skillSourcesSchema rejects invalid names and malformed requests", () => {
    expect(() =>
      skillSourcesSchema.parse({ " bad ": { source: "github:foo/bar", glob: "skills/pdf" } }),
    ).toThrow();
    expect(() => skillSourcesSchema.parse({ pdf: { source: "foo\nbar" } })).toThrow();
  });

  it("skillsConfigSchema accepts dir + sources", () => {
    const parsed = skillsConfigSchema.parse({
      dir: ".agnos/skills",
      sources: { pdf: { source: "github:foo/bar", glob: "skills/pdf" } },
    });
    expect(parsed.dir).toBe(".agnos/skills");
    expect(parsed.sources?.["pdf"]).toEqual({ source: "github:foo/bar", glob: "skills/pdf" });
  });

  it("mcpDeclarationSchema accepts minimal and full forms", () => {
    expect(mcpDeclarationSchema.parse({ name: "github" })).toBeDefined();
    expect(
      mcpDeclarationSchema.parse({
        name: "github",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: ["GITHUB_TOKEN"],
        transport: "stdio",
      }),
    ).toBeDefined();
  });

  it("agnosConfigSchema accepts mcp envFile and server declarations", () => {
    const parsed = agnosConfigSchema.parse({
      schemaVersion: 1,
      mcp: {
        envFile: ".env.local",
        servers: [{ name: "github", command: "npx", env: ["GITHUB_TOKEN"] }],
      },
    });
    expect(parsed.mcp?.envFile).toBe(".env.local");
    expect(parsed.mcp?.servers?.[0]?.env).toEqual(["GITHUB_TOKEN"]);
  });

  it("agnosConfigSchema requires schemaVersion=1 and rejects older configs", () => {
    const parsed = agnosConfigSchema.parse({
      schemaVersion: 1,
      harness: ["claude-code"],
      rules: { fragments: { "./AGENTS.md": [] } },
    });
    expect(parsed.schemaVersion).toBe(1);
    // missing schemaVersion (old shape)
    expect(() => agnosConfigSchema.parse({ harness: ["claude-code"] })).toThrow();
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
