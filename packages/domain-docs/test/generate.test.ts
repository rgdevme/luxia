import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createLogger } from "@agnos/core";
import { runGenerate } from "../src/cli/generate.js";
import type { EffectiveDocsConfig } from "../src/effective-config.js";
import { DEFAULT_DOCS_METADATA } from "../src/schema.js";

async function makeCfg(root: string): Promise<EffectiveDocsConfig> {
  const docsRoute = path.join(root, ".agnos", ".docs");
  await fs.mkdir(docsRoute, { recursive: true });
  return {
    route: docsRoute,
    routeRelative: ".agnos/.docs",
    indexName: "index",
    contentName: "content",
    docRulesName: "doc-rules",
    injectIndex: true,
    injectRules: true,
    metadata: DEFAULT_DOCS_METADATA,
    indexFile: path.join(docsRoute, "index.md"),
    contentFile: path.join(docsRoute, "content.md"),
    docRulesFile: path.join(docsRoute, "doc-rules.md"),
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
    linker: { canSymlinkFiles: async () => true, canSymlinkDirs: async () => true, link: async () => ({ kind: "symlink" as const }), unlink: async () => {} },
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
    // root-level doc → Overview section
    await fs.writeFile(
      path.join(cfg.route, "auth-flow.md"),
      "---\ntitle: Auth Flow\ndescription: How auth works.\nread_when: Always.\nagent_cant: write\n---\nAuth body.\n",
    );
    // nested doc → Getting Started section
    await fs.mkdir(path.join(cfg.route, "getting-started"), { recursive: true });
    await fs.writeFile(
      path.join(cfg.route, "getting-started", "local.md"),
      "---\ntitle: Local setup\ndescription: Run it locally.\nread_when: When starting out.\nagent_cant: write\n---\nLocal body.\n",
    );

    const result = await runGenerate(cfg, ctxFor(root));
    expect(result.indexChanged).toBe(true);
    expect(result.contentChanged).toBe(true);

    const indexText = await fs.readFile(cfg.indexFile, "utf8");
    expect(indexText).toContain("## Overview");
    expect(indexText).toContain("## Getting Started");
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
    const second = await runGenerate(cfg, ctxFor(root));
    expect(second.indexChanged).toBe(false);
    expect(second.contentChanged).toBe(false);
  });

  it("skips content.md when contentFile is null", async () => {
    const cfg: EffectiveDocsConfig = { ...(await makeCfg(root)), contentFile: null, contentName: false };
    await fs.writeFile(
      path.join(cfg.route, "x.md"),
      "---\ntitle: X\ndescription: x.\nread_when: now.\nagent_cant: write\n---\nbody\n",
    );
    const result = await runGenerate(cfg, ctxFor(root));
    expect(result.contentChanged).toBe(false);
    await expect(fs.access(path.join(cfg.route, "content.md"))).rejects.toThrow();
  });
});
