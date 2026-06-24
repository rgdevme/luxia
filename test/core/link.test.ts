import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createLinker } from "../src/fs/link.js";
import { createLogger } from "../src/logger.js";

describe("createLinker", () => {
  let dir: string;
  let cacheDir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-link-"));
    cacheDir = path.join(dir, "cache");
    await fs.mkdir(cacheDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("creates a directory link (junction on Windows, symlink elsewhere)", async () => {
    const target = path.join(dir, "target-dir");
    await fs.mkdir(target);
    await fs.writeFile(path.join(target, "marker.txt"), "hello");

    const linker = createLinker({ cacheDir, logger: createLogger() });
    const linkPath = path.join(dir, "link");
    const { kind } = await linker.link(target, linkPath);
    expect(["symlink", "junction"]).toContain(kind);

    const contents = await fs.readFile(path.join(linkPath, "marker.txt"), "utf8");
    expect(contents).toBe("hello");
  });

  it("removes existing link before creating a new one (idempotency)", async () => {
    const target = path.join(dir, "target-dir");
    await fs.mkdir(target);
    const linker = createLinker({ cacheDir, logger: createLogger() });
    const linkPath = path.join(dir, "link");
    await linker.link(target, linkPath);
    await linker.link(target, linkPath); // should not throw
  });

  it("canSymlinkDirs always returns true", async () => {
    const linker = createLinker({ cacheDir, logger: createLogger() });
    expect(await linker.canSymlinkDirs()).toBe(true);
  });
});
