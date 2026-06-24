import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createLinker, ensureLink } from "../src/fs/link.js";
import { createLogger } from "../src/logger.js";

describe("ensureLink", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-ensure-link-"));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  function linker() {
    return createLinker({
      cacheDir: path.join(dir, ".cache"),
      logger: createLogger(),
      copyFallback: true,
    });
  }

  it("creates the link when nothing exists at linkPath", async () => {
    const target = path.join(dir, "target");
    await fs.mkdir(target, { recursive: true });
    const linkPath = path.join(dir, "link");

    const out = await ensureLink(target, linkPath, linker());
    expect(out.kind === "symlink" || out.kind === "junction" || out.kind === "copy").toBe(true);
    expect(await fs.realpath(linkPath)).toBe(await fs.realpath(target));
  });

  it("returns 'already-linked' when the link already points to target", async () => {
    const target = path.join(dir, "target");
    await fs.mkdir(target, { recursive: true });
    const linkPath = path.join(dir, "link");

    await ensureLink(target, linkPath, linker());
    const second = await ensureLink(target, linkPath, linker());
    expect(second.kind).toBe("already-linked");
  });

  it("replaces a stale symlink pointing elsewhere", async () => {
    const target = path.join(dir, "target");
    const other = path.join(dir, "other");
    await fs.mkdir(target, { recursive: true });
    await fs.mkdir(other, { recursive: true });
    const linkPath = path.join(dir, "link");

    await ensureLink(other, linkPath, linker());
    const out = await ensureLink(target, linkPath, linker());
    expect(out.kind).not.toBe("already-linked");
    expect(await fs.realpath(linkPath)).toBe(await fs.realpath(target));
  });

  it("throws EEXIST when a real directory occupies linkPath", async () => {
    const target = path.join(dir, "target");
    await fs.mkdir(target, { recursive: true });
    const linkPath = path.join(dir, "link");
    await fs.mkdir(linkPath, { recursive: true });
    await fs.writeFile(path.join(linkPath, "user-data.txt"), "important", "utf8");

    await expect(ensureLink(target, linkPath, linker())).rejects.toMatchObject({ code: "EEXIST" });
    // User content is preserved.
    expect(await fs.readFile(path.join(linkPath, "user-data.txt"), "utf8")).toBe("important");
  });
});
