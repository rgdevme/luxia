import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createLogger } from "../src/logger.js";
import {
  materializeRuleMirrors,
  pruneRuleMirrors,
  resolveRules,
} from "../src/materialize-rules.js";
import type { Linker, MaterializeContext, RulesDeclaration } from "../src/types/public.js";

interface Recorder {
  ctx: MaterializeContext;
  links: { target: string; linkPath: string }[];
  unlinks: string[];
}

function recorder(projectRoot: string): Recorder {
  const links: { target: string; linkPath: string }[] = [];
  const unlinks: string[] = [];
  const linker: Linker = {
    canSymlinkFiles: async () => true,
    canSymlinkDirs: async () => true,
    async link(target, linkPath) {
      links.push({ target: path.resolve(target), linkPath: path.resolve(linkPath) });
      return { kind: "symlink" };
    },
    async unlink(linkPath) {
      unlinks.push(path.resolve(linkPath));
      await fs.rm(linkPath, { force: true }).catch(() => {});
    },
  };
  const ctx: MaterializeContext = {
    projectRoot,
    configPath: path.join(projectRoot, "agnos.json"),
    statePath: path.join(projectRoot, ".agnos", "state.json"),
    agnosRoot: path.join(projectRoot, ".agnos"),
    cacheDir: path.join(projectRoot, ".agnos", "cache"),
    logger: createLogger({ quiet: true }),
    fetcher: { fetch: async () => ({ path: "" }) },
    linker,
    agentId: "test",
    indent: "",
  };
  return { ctx, links, unlinks };
}

async function writeFile(p: string, content = "# rules\n"): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, content, "utf8");
}

describe("materializeRuleMirrors", () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-rules-mat-"));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("mirrors canonical files into a separate agent tree (cross-tree)", async () => {
    const decl: RulesDeclaration = {
      filename: "AGENTS.md",
      root: "./docs",
      dirs: ["./packages/a"],
    };
    await writeFile(path.join(root, "docs", "AGENTS.md"));
    await writeFile(path.join(root, "docs", "packages", "a", "AGENTS.md"));

    const { ctx, links } = recorder(root);
    await materializeRuleMirrors(
      resolveRules(decl, ctx),
      { agentRoot: ".", agentFilename: "CLAUDE.md" },
      ctx,
    );

    expect(new Set(links.map((l) => l.linkPath))).toEqual(
      new Set([path.resolve(root, "CLAUDE.md"), path.resolve(root, "packages", "a", "CLAUDE.md")]),
    );
    // each mirror points at the canonical under ./docs
    for (const l of links) {
      expect(path.resolve(l.target).startsWith(path.resolve(root, "docs"))).toBe(true);
    }
  });

  it("codex with root='.' is in place — no symlinks created", async () => {
    const decl: RulesDeclaration = { filename: "AGENTS.md", root: ".", dirs: ["./packages/a"] };
    await writeFile(path.join(root, "AGENTS.md"));
    await writeFile(path.join(root, "packages", "a", "AGENTS.md"));

    const { ctx, links } = recorder(root);
    await materializeRuleMirrors(
      resolveRules(decl, ctx),
      { agentRoot: ".", agentFilename: "AGENTS.md" },
      ctx,
    );

    expect(links).toEqual([]);
  });

  it("codex with root='./docs' is no longer in place — symlinks AGENTS.md mirrors", async () => {
    const decl: RulesDeclaration = { filename: "AGENTS.md", root: "./docs", dirs: [] };
    await writeFile(path.join(root, "docs", "AGENTS.md"));

    const { ctx, links } = recorder(root);
    await materializeRuleMirrors(
      resolveRules(decl, ctx),
      { agentRoot: ".", agentFilename: "AGENTS.md" },
      ctx,
    );

    expect(links).toEqual([
      {
        target: path.resolve(root, "docs", "AGENTS.md"),
        linkPath: path.resolve(root, "AGENTS.md"),
      },
    ]);
  });

  it("preserves a real, user-authored mirror file (EEXIST → warn + skip)", async () => {
    const decl: RulesDeclaration = { filename: "AGENTS.md", root: "./docs", dirs: [] };
    await writeFile(path.join(root, "docs", "AGENTS.md"), "# canonical\n");
    await writeFile(path.join(root, "CLAUDE.md"), "# hand-written\n");

    const { ctx, links } = recorder(root);
    await materializeRuleMirrors(
      resolveRules(decl, ctx),
      { agentRoot: ".", agentFilename: "CLAUDE.md" },
      ctx,
    );

    expect(links).toEqual([]); // never tried to overwrite
    expect(await fs.readFile(path.join(root, "CLAUDE.md"), "utf8")).toBe("# hand-written\n");
  });

  it("skips canonical files that are missing on disk", async () => {
    const decl: RulesDeclaration = {
      filename: "AGENTS.md",
      root: "./docs",
      dirs: ["./packages/a"],
    };
    await writeFile(path.join(root, "docs", "AGENTS.md")); // only the root file exists

    const { ctx, links } = recorder(root);
    await materializeRuleMirrors(
      resolveRules(decl, ctx),
      { agentRoot: ".", agentFilename: "CLAUDE.md" },
      ctx,
    );

    expect(links.map((l) => l.linkPath)).toEqual([path.resolve(root, "CLAUDE.md")]);
  });
});

describe("pruneRuleMirrors", () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-rules-prune-"));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("removes a copy-mode mirror (a plain file), proving prune is not symlink-only", async () => {
    const decl: RulesDeclaration = {
      filename: "AGENTS.md",
      root: "./docs",
      dirs: ["./packages/a"],
    };
    // A copied (not symlinked) mirror left at the materialized path.
    const mirror = path.join(root, "packages", "a", "CLAUDE.md");
    await writeFile(mirror, "# copy\n");

    const { ctx, unlinks } = recorder(root);
    const entry = resolveRules(decl, ctx).find((r) => r.dir === "packages/a")!;
    await pruneRuleMirrors([entry], { agentRoot: ".", agentFilename: "CLAUDE.md" }, ctx);

    expect(unlinks).toEqual([path.resolve(mirror)]);
    await expect(fs.access(mirror)).rejects.toBeTruthy();
  });

  it("never removes an in-place canonical (mirror path === canonical)", async () => {
    const decl: RulesDeclaration = { filename: "AGENTS.md", root: ".", dirs: ["./packages/a"] };
    const canonical = path.join(root, "packages", "a", "AGENTS.md");
    await writeFile(canonical);

    const { ctx, unlinks } = recorder(root);
    const entry = resolveRules(decl, ctx).find((r) => r.dir === "packages/a")!;
    await pruneRuleMirrors([entry], { agentRoot: ".", agentFilename: "AGENTS.md" }, ctx);

    expect(unlinks).toEqual([]);
    await expect(fs.access(canonical)).resolves.toBeUndefined();
  });
});

describe("resolveRules", () => {
  it("dedupes and sorts shallow→deep", async () => {
    const ctx = recorder("/proj").ctx;
    const decl: RulesDeclaration = {
      filename: "AGENTS.md",
      root: ".",
      dirs: ["./packages/a/deep", "packages/a", "."],
    };
    const dirs = resolveRules(decl, ctx).map((r) => r.dir);
    expect(dirs).toEqual([".", "packages/a", "packages/a/deep"]);
  });
});
