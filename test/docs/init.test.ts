import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import yaml from "js-yaml";
import { createLogger } from "@luxia/core";
import { runInit } from "../src/cli/init.js";

function extractFrontmatterBlock(text: string): Record<string, string> {
  const match = /^```frontmatter[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/m.exec(text);
  if (!match) throw new Error("no ```frontmatter block found");
  const body = match[1]!.replace(/^---\r?\n/, "").replace(/\r?\n---$/, "");
  return yaml.load(body) as Record<string, string>;
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

describe("runInit", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-docs-init-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("creates index.md and content.md with frontmatter, and doc-rules.md with a populated frontmatter block", async () => {
    await runInit(ctxFor(root));
    const indexText = await fs.readFile(path.join(root, ".docs", "index.md"), "utf8");
    const contentText = await fs.readFile(path.join(root, ".docs", "content.md"), "utf8");
    const docRulesText = await fs.readFile(path.join(root, ".docs", "doc-rules.md"), "utf8");
    expect(indexText.startsWith("---")).toBe(true);
    expect(contentText.startsWith("---")).toBe(true);
    const parsed = extractFrontmatterBlock(docRulesText);
    expect(parsed["title"]).toBeDefined();
    expect(parsed["agent_cant"]).toBeDefined();
  });

  it("re-running init is a no-op when metadata is unchanged", async () => {
    await runInit(ctxFor(root));
    const docRulesPath = path.join(root, ".docs", "doc-rules.md");
    const first = await fs.readFile(docRulesPath, "utf8");
    await runInit(ctxFor(root));
    const second = await fs.readFile(docRulesPath, "utf8");
    expect(second).toBe(first);
  });

  it("re-injects the frontmatter block from updated metadata on re-run", async () => {
    await runInit(ctxFor(root));
    const docRulesPath = path.join(root, ".docs", "doc-rules.md");
    const before = extractFrontmatterBlock(await fs.readFile(docRulesPath, "utf8"));
    expect(before["read_when"]).toBeDefined();

    // Simulate the user editing agnos.json#docs.metadata.
    const cfg = JSON.parse(await fs.readFile(path.join(root, "agnos.json"), "utf8")) as {
      docs: { metadata: Record<string, string> };
    };
    cfg.docs.metadata = {
      title: "Title",
      description: "Description",
      when_to_read: "When the agent should read it",
      agent_cant: "What the agent must not do",
    };
    await fs.writeFile(path.join(root, "agnos.json"), JSON.stringify(cfg, null, 2));

    await runInit(ctxFor(root));
    const after = extractFrontmatterBlock(await fs.readFile(docRulesPath, "utf8"));
    expect(after["when_to_read"]).toBe("When the agent should read it");
    expect(after["read_when"]).toBeUndefined();
  });

  it("skips content.md when content config is false", async () => {
    await fs.writeFile(path.join(root, "agnos.json"), JSON.stringify({ docs: { content: false } }));
    await runInit(ctxFor(root));
    await expect(fs.access(path.join(root, ".docs", "index.md"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(root, ".docs", "doc-rules.md"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(root, ".docs", "content.md"))).rejects.toThrow();
  });

  it("seeds DEFAULT_DOCS_METADATA into agnos.json on first run", async () => {
    await runInit(ctxFor(root));
    const raw = await fs.readFile(path.join(root, "agnos.json"), "utf8");
    const config = JSON.parse(raw) as { docs?: { metadata?: Record<string, string> } };
    expect(config.docs?.metadata).toBeDefined();
    expect(Object.keys(config.docs!.metadata!).sort()).toEqual([
      "agent_cant",
      "description",
      "read_when",
      "title",
    ]);
    expect(typeof config.docs!.metadata!["title"]).toBe("string");
    expect(typeof config.docs!.metadata!["agent_cant"]).toBe("string");
  });

  it("does not overwrite an existing docs.metadata block", async () => {
    const custom = { title: "Custom title field description" };
    await fs.writeFile(
      path.join(root, "agnos.json"),
      JSON.stringify({ docs: { metadata: custom } }),
    );
    await runInit(ctxFor(root));
    const raw = await fs.readFile(path.join(root, "agnos.json"), "utf8");
    const config = JSON.parse(raw) as { docs?: { metadata?: unknown } };
    expect(config.docs?.metadata).toEqual(custom);
  });

  it("preserves other docs config keys while seeding metadata", async () => {
    await fs.writeFile(
      path.join(root, "agnos.json"),
      JSON.stringify({ docs: { injectIndex: false } }),
    );
    await runInit(ctxFor(root));
    const raw = await fs.readFile(path.join(root, "agnos.json"), "utf8");
    const config = JSON.parse(raw) as { docs?: { metadata?: unknown; injectIndex?: boolean } };
    expect(config.docs?.injectIndex).toBe(false);
    expect(config.docs?.metadata).toBeDefined();
  });
});
