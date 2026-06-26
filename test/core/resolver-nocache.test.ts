import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const downloadTemplate = vi.fn(async (_src: string, opts: { dir: string }) => {
  await fs.mkdir(opts.dir, { recursive: true });
  await fs.writeFile(path.join(opts.dir, "marker.txt"), "ok");
  return { dir: opts.dir };
});

vi.mock("giget", () => ({
  downloadTemplate: (src: string, opts: { dir: string }) => downloadTemplate(src, opts),
}));

import { createRepoFetcher, gigetTarballPath, parseSource } from "../../src/core/index.js";

describe("createRepoFetcher noCache", () => {
  let root: string;
  let cacheHome: string;
  let originalXdg: string | undefined;

  beforeEach(async () => {
    downloadTemplate.mockClear();
    root = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-resolver-"));
    cacheHome = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-xdg-"));
    originalXdg = process.env["XDG_CACHE_HOME"];
    process.env["XDG_CACHE_HOME"] = cacheHome;
  });

  afterEach(async () => {
    if (originalXdg === undefined) delete process.env["XDG_CACHE_HOME"];
    else process.env["XDG_CACHE_HOME"] = originalXdg;
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(cacheHome, { recursive: true, force: true });
  });

  it("wipes giget's cached tarball before fetching when noCache is set", async () => {
    const source = parseSource("github:vercel-labs/agent-skills", { projectRoot: root });
    if (source.kind !== "git") throw new Error("expected git source");

    const tarPath = gigetTarballPath(source, undefined);
    await fs.mkdir(path.dirname(tarPath), { recursive: true });
    await fs.writeFile(tarPath, "stale-tarball");
    await fs.writeFile(`${tarPath}.json`, JSON.stringify({ etag: "old" }));

    const fetcher = createRepoFetcher({
      projectRoot: root,
      cacheDir: path.join(root, ".agnos", "cache"),
    });
    await fetcher.fetch(source, { noCache: true });

    await expect(fs.access(tarPath)).rejects.toThrow();
    await expect(fs.access(`${tarPath}.json`)).rejects.toThrow();
    expect(downloadTemplate).toHaveBeenCalledOnce();
  });

  it("rejects refs that escape the source's cache directory", async () => {
    const source = parseSource("github:vercel-labs/agent-skills", { projectRoot: root });
    if (source.kind !== "git") throw new Error("expected git source");

    const sentinelDir = path.join(cacheHome, "giget", "github", "other-repo");
    await fs.mkdir(sentinelDir, { recursive: true });
    const sentinel = path.join(sentinelDir, "main.tar.gz");
    await fs.writeFile(sentinel, "sibling-tarball");

    expect(() => gigetTarballPath(source, "../../other-repo/main")).toThrow(/escapes/);

    const fetcher = createRepoFetcher({
      projectRoot: root,
      cacheDir: path.join(root, ".agnos", "cache"),
    });
    await expect(
      fetcher.fetch(source, { ref: "../../other-repo/main", noCache: true }),
    ).rejects.toThrow(/escapes/);

    // The sibling tarball must not have been touched.
    const sibling = await fs.readFile(sentinel, "utf8");
    expect(sibling).toBe("sibling-tarball");
    expect(downloadTemplate).not.toHaveBeenCalled();
  });

  it("leaves giget's cached tarball untouched when noCache is not set", async () => {
    const source = parseSource("github:vercel-labs/agent-skills", { projectRoot: root });
    if (source.kind !== "git") throw new Error("expected git source");

    const tarPath = gigetTarballPath(source, undefined);
    await fs.mkdir(path.dirname(tarPath), { recursive: true });
    await fs.writeFile(tarPath, "stale-tarball");

    const fetcher = createRepoFetcher({
      projectRoot: root,
      cacheDir: path.join(root, ".agnos", "cache"),
    });
    await fetcher.fetch(source);

    const stillThere = await fs.readFile(tarPath, "utf8");
    expect(stillThere).toBe("stale-tarball");
  });
});
