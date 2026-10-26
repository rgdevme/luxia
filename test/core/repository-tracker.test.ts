import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { createRepositoryTracker } from "../../src/core/index.js";

const execFile = promisify(execFileCallback);
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map(async (directory) => await fs.rm(directory, { recursive: true, force: true })),
  );
});

async function buildRemote(): Promise<{ remote: string; work: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-repository-tracker-"));
  directories.push(root);
  const work = path.join(root, "work");
  const remote = path.join(root, "remote.git");
  await fs.mkdir(work);
  await execFile("git", ["init", "-b", "develop", work]);
  await execFile("git", ["-C", work, "config", "user.name", "Agnos Test"]);
  await execFile("git", ["-C", work, "config", "user.email", "agnos@example.test"]);
  await fs.mkdir(path.join(work, "skills", "example"), { recursive: true });
  await fs.writeFile(path.join(work, "skills", "example", "SKILL.md"), "# Example\n");
  await fs.writeFile(path.join(work, "skills", "example", "support.txt"), "support\n");
  await execFile("git", ["-C", work, "add", "."]);
  await execFile("git", ["-C", work, "commit", "-m", "initial"]);
  await execFile("git", ["clone", "--bare", work, remote]);
  return { remote: `file://${remote.replace(/\\/g, "/")}`, work };
}

describe("RepositoryTracker", () => {
  it("resolves a non-main default branch and shares a checkout across selections", async () => {
    const { remote } = await buildRemote();
    const tracker = createRepositoryTracker({ storeDir: path.join(directories[0]!, "store") });
    const consumer = { projectId: "project-a", domain: "skills", name: "example" };
    const rootSelection = await tracker.add({ source: remote }, consumer);
    const nestedSelection = await tracker.add(
      { source: remote, glob: "skills/example" },
      { ...consumer, name: "example-nested" },
    );

    expect(rootSelection.branch).toBe("develop");
    expect(rootSelection.checkoutPath).toBe(nestedSelection.checkoutPath);
    expect(nestedSelection.entries).toEqual([
      expect.objectContaining({ path: "skills/example", kind: "directory" }),
    ]);

    await tracker.remove(rootSelection.trackingId, consumer);
    await expect(fs.access(nestedSelection.checkoutPath)).resolves.toBeUndefined();
  });

  it("detects and fast-forward updates a live checkout", async () => {
    const { remote, work } = await buildRemote();
    const tracker = createRepositoryTracker({ storeDir: path.join(directories[0]!, "store") });
    const info = await tracker.add(
      { source: remote },
      { projectId: "project-a", domain: "references", name: "docs" },
    );

    await fs.writeFile(path.join(work, "next.txt"), "next\n");
    await execFile("git", ["-C", work, "add", "."]);
    await execFile("git", ["-C", work, "commit", "-m", "next"]);
    await execFile("git", ["-C", work, "push", remote, "develop"]);

    await expect(tracker.shouldUpdate(info.trackingId)).resolves.toBe(true);
    const updated = await tracker.update(info.trackingId);
    expect(updated.commit).not.toBe(info.commit);
    await expect(tracker.shouldUpdate(info.trackingId)).resolves.toBe(false);
    await expect(fs.readFile(path.join(updated.checkoutPath, "next.txt"), "utf8")).resolves.toBe(
      "next\n",
    );
  });

  it("does not register a selection that matches no repository content", async () => {
    const { remote } = await buildRemote();
    const storeDir = path.join(directories[0]!, "invalid-selection-store");
    const tracker = createRepositoryTracker({ storeDir });
    await expect(
      tracker.add(
        { source: remote, glob: "missing/**" },
        { projectId: "project-a", domain: "references", name: "missing" },
      ),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(storeDir, "repositories", "catalog.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("lists registrations for a consumer without changing ownership", async () => {
    const { remote } = await buildRemote();
    const tracker = createRepositoryTracker({ storeDir: path.join(directories[0]!, "store") });
    const consumer = { projectId: "project-a", domain: "skills", name: "example" };
    const info = await tracker.add({ source: remote, glob: "skills/example" }, consumer);

    await expect(tracker.listRegistrations(consumer)).resolves.toEqual([
      {
        trackingId: info.trackingId,
        request: expect.objectContaining({ branch: "develop", glob: "skills/example" }),
      },
    ]);
    await expect(tracker.listRegistrations({ ...consumer, name: "another" })).resolves.toEqual([]);
  });

  it("releases a dirty checkout's consumer without deleting the checkout", async () => {
    const { remote } = await buildRemote();
    const tracker = createRepositoryTracker({ storeDir: path.join(directories[0]!, "store") });
    const consumer = { projectId: "project-a", domain: "references", name: "docs" };
    const info = await tracker.add({ source: remote }, consumer);
    const localEdit = path.join(info.checkoutPath, "local-edit.txt");
    await fs.writeFile(localEdit, "keep me\n");

    await expect(tracker.remove(info.trackingId, consumer)).resolves.toBeUndefined();
    await expect(fs.readFile(localEdit, "utf8")).resolves.toBe("keep me\n");
  });
});
