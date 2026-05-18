import { describe, it, expect, beforeEach } from "vitest";
import path from "node:path";
import os from "node:os";
import { ensureSymlinkPrivileges, resetSymlinkDecisionCache } from "../src/context.js";
import type { Linker, ResolveContext } from "../src/types/public.js";
import { createLogger } from "../src/logger.js";

function ctxWithLinker(linker: Linker): ResolveContext {
  const root = os.tmpdir();
  return {
    projectRoot: root,
    configPath: path.join(root, "agnos.json"),
    statePath: path.join(root, ".agnos", "state.json"),
    agnosRoot: path.join(root, ".agnos"),
    cacheDir: path.join(root, ".agnos", "cache"),
    logger: createLogger(),
    fetcher: { fetch: async () => ({ path: "" }) },
    linker,
  };
}

describe("ensureSymlinkPrivileges cache", () => {
  beforeEach(() => {
    resetSymlinkDecisionCache();
  });

  it("probes once across multiple calls (cached decision)", async () => {
    let probes = 0;
    const linker: Linker = {
      async canSymlinkFiles() {
        probes += 1;
        return false;
      },
      async canSymlinkDirs() {
        return true;
      },
      async link() {
        return { kind: "symlink" };
      },
      async unlink() {},
    };
    const ctx = ctxWithLinker(linker);
    const a = await ensureSymlinkPrivileges(
      ctx,
      { fileSymlinks: true, dirSymlinks: true },
      { interactive: false, autoCopy: true },
    );
    const b = await ensureSymlinkPrivileges(
      ctx,
      { fileSymlinks: true, dirSymlinks: true },
      { interactive: false, autoCopy: true },
    );
    expect(probes).toBe(1);
    expect(a).toEqual(b);
    expect(a.copyFallback).toBe(true);
  });

  it("reset clears the cache", async () => {
    let probes = 0;
    const linker: Linker = {
      async canSymlinkFiles() {
        probes += 1;
        return false;
      },
      async canSymlinkDirs() {
        return true;
      },
      async link() {
        return { kind: "symlink" };
      },
      async unlink() {},
    };
    const ctx = ctxWithLinker(linker);
    await ensureSymlinkPrivileges(
      ctx,
      { fileSymlinks: true, dirSymlinks: true },
      { interactive: false, autoCopy: true },
    );
    resetSymlinkDecisionCache();
    await ensureSymlinkPrivileges(
      ctx,
      { fileSymlinks: true, dirSymlinks: true },
      { interactive: false, autoCopy: true },
    );
    expect(probes).toBe(2);
  });

  it("short-circuits when no file symlinks are needed", async () => {
    let probes = 0;
    const linker: Linker = {
      async canSymlinkFiles() {
        probes += 1;
        return true;
      },
      async canSymlinkDirs() {
        return true;
      },
      async link() {
        return { kind: "symlink" };
      },
      async unlink() {},
    };
    const ctx = ctxWithLinker(linker);
    const r = await ensureSymlinkPrivileges(
      ctx,
      { fileSymlinks: false, dirSymlinks: true },
      { interactive: false },
    );
    expect(probes).toBe(0);
    expect(r).toEqual({ proceed: true, copyFallback: false });
  });
});
