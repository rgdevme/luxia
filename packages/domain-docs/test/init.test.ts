import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createLogger } from "@agnos/core";
import { runInit } from "../src/cli/init.js";

function ctxFor(projectRoot: string) {
  return {
    projectRoot,
    configPath: path.join(projectRoot, "agnos.json"),
    agnosRoot: path.join(projectRoot, ".agnos"),
    cacheDir: path.join(projectRoot, ".agnos", "cache"),
    logger: createLogger(),
    fetcher: { resolve: async () => ({ path: "" }) },
    linker: { canSymlinkFiles: async () => true, canSymlinkDirs: async () => true, link: async () => ({ kind: "symlink" as const }), unlink: async () => {} },
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

  it("creates the three initial files with frontmatter", async () => {
    await runInit(ctxFor(root));
    const indexText = await fs.readFile(path.join(root, ".agnos", ".docs", "index.md"), "utf8");
    const contentText = await fs.readFile(path.join(root, ".agnos", ".docs", "content.md"), "utf8");
    const docRulesText = await fs.readFile(path.join(root, ".agnos", ".docs", "doc-rules.md"), "utf8");
    expect(indexText.startsWith("---")).toBe(true);
    expect(contentText.startsWith("---")).toBe(true);
    expect(docRulesText.startsWith("---")).toBe(true);
  });

  it("re-running does not overwrite existing user edits", async () => {
    await runInit(ctxFor(root));
    const docRulesPath = path.join(root, ".agnos", ".docs", "doc-rules.md");
    const edited = "---\ntitle: Hacked\ndescription: x\nread_when: never\nagent_cant: write\n---\nedited body\n";
    await fs.writeFile(docRulesPath, edited);
    await runInit(ctxFor(root));
    const after = await fs.readFile(docRulesPath, "utf8");
    expect(after).toBe(edited);
  });

  it("skips content.md when content config is false", async () => {
    await fs.writeFile(
      path.join(root, "agnos.json"),
      JSON.stringify({ docs: { content: false } }),
    );
    await runInit(ctxFor(root));
    await expect(fs.access(path.join(root, ".agnos", ".docs", "index.md"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(root, ".agnos", ".docs", "doc-rules.md"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(root, ".agnos", ".docs", "content.md"))).rejects.toThrow();
  });
});
