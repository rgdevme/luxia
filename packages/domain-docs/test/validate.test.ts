import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createLogger } from "@luxia/core";
import { runValidate } from "../src/cli/validate.js";
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
    // resolver/linker not exercised by validate
    fetcher: { resolve: async () => ({ path: "" }) },
    linker: {
      canSymlinkFiles: async () => true,
      canSymlinkDirs: async () => true,
      link: async () => ({ kind: "symlink" as const }),
      unlink: async () => {},
    },
  };
}

describe("runValidate", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-docs-validate-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("returns no issues for a valid user doc", async () => {
    const cfg = await makeCfg(root);
    const file = path.join(cfg.route, "feature.md");
    await fs.writeFile(
      file,
      "---\ntitle: Feature\ndescription: A feature.\nread_when: You're using it.\nagent_cant: write\n---\nbody\n",
    );
    const result = await runValidate(cfg, ctxFor(root));
    expect(result.checked).toBe(1);
    expect(result.issues).toEqual([]);
  });

  it("flags missing metadata keys (presence-only)", async () => {
    const cfg = await makeCfg(root);
    const file = path.join(cfg.route, "bad.md");
    await fs.writeFile(file, "---\ntitle: Bad\nagent_cant: modify\n---\nbody\n");
    const result = await runValidate(cfg, ctxFor(root));
    expect(result.issues.length).toBe(1);
    const issue = result.issues[0]!;
    expect(issue.missing.sort()).toEqual(["description", "read_when"]);
    // Note: `agent_cant: modify` is NOT flagged. The LLM enforces the prose
    // constraint described in the schema; the validator only checks presence.
  });

  it("excludes the three init files even when they have no frontmatter", async () => {
    const cfg = await makeCfg(root);
    await fs.writeFile(cfg.indexFile, "no frontmatter\n");
    await fs.writeFile(cfg.contentFile!, "no frontmatter\n");
    await fs.writeFile(cfg.docRulesFile, "no frontmatter\n");
    const result = await runValidate(cfg, ctxFor(root));
    expect(result.checked).toBe(0);
    expect(result.issues).toEqual([]);
  });
});
