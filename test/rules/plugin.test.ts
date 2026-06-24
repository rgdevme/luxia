import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createLogger, readConfigOrDefault } from "../../src/core/index.js";
import type { InitStep, ResolveContext } from "../../src/core/index.js";
import rulesPlugin from "../../src/domains/rules/index.js";

function ctxFor(projectRoot: string): ResolveContext {
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

function step(id: string): Extract<InitStep, { type: "text" }> {
  const s = rulesPlugin.initSteps?.find((x) => x.id === id);
  if (!s || s.type !== "text") throw new Error(`no text init step ${id}`);
  return s;
}

describe("domain-rules plugin", () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-rules-plugin-"));
    await fs.writeFile(path.join(root, "agnos.json"), JSON.stringify({ agents: [] }), "utf8");
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("init steps persist filename + root and create the root file", async () => {
    const ctx = ctxFor(root);
    await step("filename").callback("AGENTS.md", ctx);
    await step("root").callback("./docs", ctx);

    const cfg = await readConfigOrDefault(ctx.configPath);
    expect(cfg.rules).toEqual({ filename: "AGENTS.md", root: "./docs", dirs: [] });
    await expect(fs.access(path.join(root, "docs", "AGENTS.md"))).resolves.toBeUndefined();
  });

  it("list returns the root file plus each dir, shallow→deep", async () => {
    await fs.writeFile(
      path.join(root, "agnos.json"),
      JSON.stringify({ rules: { filename: "AGENTS.md", root: ".", dirs: ["./packages/a"] } }),
      "utf8",
    );
    const entries = await rulesPlugin.list!(ctxFor(root));
    expect(entries.map((e) => e.dir)).toEqual([".", "packages/a"]);
    expect(entries.map((e) => e.relativeSource)).toEqual(["./AGENTS.md", "./packages/a/AGENTS.md"]);
  });

  it("resolve returns the root file entry", async () => {
    await fs.writeFile(
      path.join(root, "agnos.json"),
      JSON.stringify({ rules: { filename: "AGENTS.md", root: "./docs", dirs: [] } }),
      "utf8",
    );
    const cfg = await readConfigOrDefault(ctxFor(root).configPath);
    const resolved = await rulesPlugin.resolve!(cfg.rules!, ctxFor(root));
    expect(resolved.dir).toBe(".");
    expect(resolved.relativeSource).toBe("./docs/AGENTS.md");
  });
});
