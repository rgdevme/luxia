import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildResolveContext } from "../../src/core/context.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("buildResolveContext", () => {
  it("uses an injected global store and project-local temporary work", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-context-"));
    roots.push(root);
    const storeDir = path.join(root, "global-store");

    const ctx = await buildResolveContext({ projectRoot: root, storeDir });

    expect(ctx.storeDir).toBe(storeDir);
    await expect(fs.access(path.join(root, ".agnos", "tmp"))).resolves.toBeUndefined();
    await ctx.fetcher.cleanup();
  });
});
