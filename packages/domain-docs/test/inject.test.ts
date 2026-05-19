import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createLogger } from "@luxia/core";
import { runInject } from "../src/cli/inject.js";
import { readEffectiveDocsConfig } from "../src/effective-config.js";

function ctxFor(projectRoot: string) {
  return {
    projectRoot,
    configPath: path.join(projectRoot, "agnos.json"),
    statePath: path.join(projectRoot, ".agnos", "state.json"),
    agnosRoot: path.join(projectRoot, ".agnos"),
    cacheDir: path.join(projectRoot, ".agnos", "cache"),
    logger: createLogger({ quiet: true }),
    fetcher: { fetch: async () => ({ path: "" }) },
    linker: {
      canSymlinkFiles: async () => true,
      canSymlinkDirs: async () => true,
      link: async () => ({ kind: "symlink" as const }),
      unlink: async () => {},
    },
  };
}

describe("runInject gating", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-docs-inject-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("no-ops when agnos.json#rules.source is unset", async () => {
    await fs.writeFile(
      path.join(root, "agnos.json"),
      JSON.stringify({ docs: { injectIndex: true, injectRules: true } }),
    );
    await fs.mkdir(path.join(root, ".docs"), { recursive: true });
    await fs.writeFile(path.join(root, ".docs", "index.md"), "# Index\n");
    await fs.writeFile(path.join(root, ".docs", "doc-rules.md"), "# DocRules\n");

    const ctx = ctxFor(root);
    const cfg = await readEffectiveDocsConfig(ctx);
    const result = await runInject(cfg, ctx);
    expect(result.changed).toBe(false);
    // No file is written or created when there's no rules source.
    await expect(fs.access(path.join(root, "AGENTS.md"))).rejects.toThrow();
  });

  it("no-ops when rules.source is set but the file does not exist", async () => {
    await fs.writeFile(
      path.join(root, "agnos.json"),
      JSON.stringify({
        rules: { source: "./AGENTS.md" },
        docs: { injectIndex: true, injectRules: true },
      }),
    );
    await fs.mkdir(path.join(root, ".docs"), { recursive: true });
    await fs.writeFile(path.join(root, ".docs", "index.md"), "# Index\n");
    await fs.writeFile(path.join(root, ".docs", "doc-rules.md"), "# DocRules\n");

    const ctx = ctxFor(root);
    const cfg = await readEffectiveDocsConfig(ctx);
    const result = await runInject(cfg, ctx);
    expect(result.changed).toBe(false);
    // Don't create the rules file just because inject was asked for.
    await expect(fs.access(path.join(root, "AGENTS.md"))).rejects.toThrow();
  });

  it("injects when both rules.source is set and the file exists", async () => {
    await fs.writeFile(
      path.join(root, "agnos.json"),
      JSON.stringify({
        rules: { source: "./AGENTS.md" },
        docs: { injectIndex: true, injectRules: true },
      }),
    );
    await fs.writeFile(
      path.join(root, "AGENTS.md"),
      "# AGENTS\n\n## Documentation Rules\n>__Documentation rules end__\n\n## Documentation Index\n>__Documentation index end__\n",
    );
    await fs.mkdir(path.join(root, ".docs"), { recursive: true });
    await fs.writeFile(path.join(root, ".docs", "index.md"), "- [foo](foo.md)\n");
    await fs.writeFile(path.join(root, ".docs", "doc-rules.md"), "rule line\n");

    const ctx = ctxFor(root);
    const cfg = await readEffectiveDocsConfig(ctx);
    const result = await runInject(cfg, ctx);
    expect(result.changed).toBe(true);
    const after = await fs.readFile(path.join(root, "AGENTS.md"), "utf8");
    expect(after).toContain("- [foo](foo.md)");
    expect(after).toContain("rule line");
  });
});
