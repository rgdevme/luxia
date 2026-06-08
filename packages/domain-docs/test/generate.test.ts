import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import yaml from "js-yaml";
import { createLogger } from "@luxia/core";
import { runGenerate } from "../src/cli/generate.js";
import type { EffectiveDocsConfig } from "../src/effective-config.js";
import { DEFAULT_DOCS_METADATA } from "../src/schema.js";

function extractFrontmatterBlock(text: string): Record<string, string> {
  const match = /^```frontmatter[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/m.exec(text);
  if (!match) throw new Error("no ```frontmatter block found");
  const body = match[1]!.replace(/^---\r?\n/, "").replace(/\r?\n---$/, "");
  return yaml.load(body) as Record<string, string>;
}

async function makeCfg(
  root: string,
  overrides: Partial<EffectiveDocsConfig> = {},
): Promise<EffectiveDocsConfig> {
  const docsRoute = path.join(root, ".docs");
  await fs.mkdir(docsRoute, { recursive: true });
  return {
    route: docsRoute,
    routeRelative: ".docs",
    indexName: "index",
    contentName: "content",
    docRulesName: "doc-rules",
    injectIndex: true,
    injectRules: true,
    metadata: DEFAULT_DOCS_METADATA,
    indexFile: path.join(docsRoute, "index.md"),
    contentFile: path.join(docsRoute, "content.md"),
    docRulesFile: path.join(docsRoute, "doc-rules.md"),
    ...overrides,
  };
}

function ctxFor(projectRoot: string) {
  return {
    projectRoot,
    configPath: path.join(projectRoot, "agnos.json"),
    agnosRoot: path.join(projectRoot, ".agnos"),
    cacheDir: path.join(projectRoot, ".agnos", "cache"),
    logger: createLogger(),
    fetcher: { resolve: async () => ({ path: "" }) },
    linker: {
      canSymlinkFiles: async () => true,
      canSymlinkDirs: async () => true,
      link: async () => ({ kind: "symlink" as const }),
      unlink: async () => {},
    },
  };
}

describe("runGenerate", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-docs-generate-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("produces sectioned index.md and concatenated content.md", async () => {
    const cfg = await makeCfg(root);
    await fs.writeFile(
      path.join(cfg.route, "auth-flow.md"),
      "---\ntitle: Auth Flow\ndescription: How auth works.\nread_when: Always.\nagent_cant: write\n---\nAuth body.\n",
    );
    await fs.mkdir(path.join(cfg.route, "getting-started"), { recursive: true });
    await fs.writeFile(
      path.join(cfg.route, "getting-started", "local.md"),
      "---\ntitle: Local setup\ndescription: Run it locally.\nread_when: When starting out.\nagent_cant: write\n---\nLocal body.\n",
    );

    const result = await runGenerate(cfg, ctxFor(root));
    expect(result.indexChanged).toBe(true);
    expect(result.contentChanged).toBe(true);
    expect(result.docRulesChanged).toBe(true);

    const indexText = await fs.readFile(cfg.indexFile, "utf8");
    expect(indexText).toContain("### Overview");
    expect(indexText).toContain("### Getting Started");
    expect(indexText).toContain("[Auth Flow](auth-flow.md): How auth works.");
    expect(indexText).toContain("[Local setup](getting-started/local.md): Run it locally.");

    const contentText = await fs.readFile(cfg.contentFile!, "utf8");
    expect(contentText).toContain("# Auth Flow");
    expect(contentText).toContain("Auth body.");
    expect(contentText).toContain("# Local setup");
    expect(contentText).toContain("Local body.");
  });

  it("is idempotent when nothing changed", async () => {
    const cfg = await makeCfg(root);
    await fs.writeFile(
      path.join(cfg.route, "x.md"),
      "---\ntitle: X\ndescription: x.\nread_when: now.\nagent_cant: write\n---\nbody\n",
    );
    const first = await runGenerate(cfg, ctxFor(root));
    expect(first.indexChanged).toBe(true);
    expect(first.docRulesChanged).toBe(true);
    const second = await runGenerate(cfg, ctxFor(root));
    expect(second.indexChanged).toBe(false);
    expect(second.contentChanged).toBe(false);
    expect(second.docRulesChanged).toBe(false);
  });

  it("skips content.md when contentFile is null", async () => {
    const cfg = await makeCfg(root, { contentFile: null, contentName: false });
    await fs.writeFile(
      path.join(cfg.route, "x.md"),
      "---\ntitle: X\ndescription: x.\nread_when: now.\nagent_cant: write\n---\nbody\n",
    );
    const result = await runGenerate(cfg, ctxFor(root));
    expect(result.contentChanged).toBe(false);
    await expect(fs.access(path.join(cfg.route, "content.md"))).rejects.toThrow();
  });

  it("seeds doc-rules.md from the default template with a populated frontmatter block", async () => {
    const cfg = await makeCfg(root);
    await runGenerate(cfg, ctxFor(root));
    const rules = await fs.readFile(cfg.docRulesFile, "utf8");
    expect(rules).toContain("When working with documentation in this project");
    expect(rules).toContain("### Maintenance conventions");
    expect(rules).not.toContain("autogenerated");
    expect(rules).not.toMatch(/Never edit `[^`]*doc-rules\.md/);
    const parsed = extractFrontmatterBlock(rules);
    for (const [key, description] of Object.entries(DEFAULT_DOCS_METADATA)) {
      expect(parsed[key]).toBe(description);
    }
  });

  it("preserves user edits outside the frontmatter block on regeneration", async () => {
    const cfg = await makeCfg(root);
    await runGenerate(cfg, ctxFor(root));
    const seeded = await fs.readFile(cfg.docRulesFile, "utf8");
    const edited = `${seeded}\n\n### My team conventions\n\n- Be kind.\n`;
    await fs.writeFile(cfg.docRulesFile, edited, "utf8");

    const renamed = await makeCfg(root, {
      metadata: { title: "Title", audience: "Who reads this" },
    });
    const result = await runGenerate(renamed, ctxFor(root));
    expect(result.docRulesChanged).toBe(true);

    const after = await fs.readFile(renamed.docRulesFile, "utf8");
    expect(after).toContain("### My team conventions");
    expect(after).toContain("- Be kind.");
    const parsed = extractFrontmatterBlock(after);
    expect(parsed).toEqual({ title: "Title", audience: "Who reads this" });
  });

  it("prepends the frontmatter block when the user deletes it", async () => {
    const cfg = await makeCfg(root);
    await fs.writeFile(cfg.docRulesFile, "Just some prose.\n", "utf8");
    await runGenerate(cfg, ctxFor(root));
    const after = await fs.readFile(cfg.docRulesFile, "utf8");
    expect(after.startsWith("```frontmatter\n")).toBe(true);
    expect(after).toContain("Just some prose.");
    expect(extractFrontmatterBlock(after)["title"]).toBe(DEFAULT_DOCS_METADATA["title"]);
  });

  it("uses metadata keys from cfg.metadata in generated frontmatter, in declaration order", async () => {
    const cfg = await makeCfg(root, {
      metadata: {
        title: "Document title",
        owner: "Document owner",
        when_to_read: "When the agent should read it",
      },
    });
    await runGenerate(cfg, ctxFor(root));

    const indexText = await fs.readFile(cfg.indexFile, "utf8");
    const fm = indexText.split("---")[1]!;
    const keys = fm
      .trim()
      .split("\n")
      .map((line) => line.split(":")[0]);
    expect(keys).toEqual(["title", "owner", "when_to_read"]);
    // index supplies a synthesized value for `title`; unknown keys come out empty.
    expect(indexText).toContain("title: Documentation Index");
    expect(indexText).toMatch(/owner:\s*$/m);
    expect(indexText).toMatch(/when_to_read:\s*$/m);

    const rules = await fs.readFile(cfg.docRulesFile, "utf8");
    const parsed = extractFrontmatterBlock(rules);
    expect(parsed).toEqual({
      title: "Document title",
      owner: "Document owner",
      when_to_read: "When the agent should read it",
    });
  });

  it("regenerates doc-rules when metadata changes", async () => {
    const cfg = await makeCfg(root);
    await runGenerate(cfg, ctxFor(root));
    const before = extractFrontmatterBlock(await fs.readFile(cfg.docRulesFile, "utf8"));
    expect(before["read_when"]).toBeDefined();

    const renamed = await makeCfg(root, {
      metadata: {
        title: "Title",
        description: "Description",
        when_to_read: "When to read it",
        agent_cant: "What the agent must not do",
      },
    });
    const result = await runGenerate(renamed, ctxFor(root));
    expect(result.docRulesChanged).toBe(true);
    const after = extractFrontmatterBlock(await fs.readFile(renamed.docRulesFile, "utf8"));
    expect(after["when_to_read"]).toBe("When to read it");
    expect(after["read_when"]).toBeUndefined();
  });
});
