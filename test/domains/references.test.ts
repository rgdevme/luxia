import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CommandContext,
  RepositoryTrackInfo,
  RepositoryTracker,
} from "../../src/core/index.js";
import { createLinker, createLogger, readConfig } from "../../src/core/index.js";
import { referencesDomain } from "../../src/domains/references/index.js";

let root: string;

afterEach(async () => {
  if (root) await fs.rm(root, { recursive: true, force: true });
});

describe("references commands", () => {
  it("adds idempotently, links the selection, and releases it on removal", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-references-"));
    const storeDir = path.join(root, "store");
    const selectedDirectory = path.join(
      storeDir,
      "repositories",
      "checkouts",
      "repository",
      "main",
    );
    await fs.mkdir(selectedDirectory, { recursive: true });
    await fs.writeFile(path.join(selectedDirectory, "README.md"), "reference\n");
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify(
        { private: true, workspaces: { packages: ["packages/*"], nohoist: ["kept"] } },
        null,
        2,
      ),
    );
    await fs.writeFile(
      path.join(root, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n  - '!packages/private/**'\ncatalog:\n  kept: 1.0.0\n",
    );
    const info: RepositoryTrackInfo = {
      trackingId: "tracking-id",
      repositoryId: "repository-id",
      request: { source: "https://example.test/org/repo.git", branch: "main", glob: "." },
      branch: "main",
      commit: "a".repeat(40),
      checkoutPath: selectedDirectory,
      entries: [{ path: ".", absolutePath: selectedDirectory, kind: "directory" }],
    };
    const consumers = new Map<
      string,
      { trackingId: string; request: RepositoryTrackInfo["request"] }[]
    >();
    const consumerKey = (consumer: { projectId: string; domain: string; name: string }) =>
      `${consumer.projectId}:${consumer.domain}:${consumer.name}`;
    const tracker: RepositoryTracker = {
      add: vi.fn(async (_request, consumer) => {
        consumers.set(consumerKey(consumer), [
          { trackingId: info.trackingId, request: info.request },
        ]);
        return info;
      }),
      update: vi.fn(async () => info),
      shouldUpdate: vi.fn(async () => false),
      remove: vi.fn(async (trackingId, consumer) => {
        consumers.set(
          consumerKey(consumer),
          (consumers.get(consumerKey(consumer)) ?? []).filter(
            (item) => item.trackingId !== trackingId,
          ),
        );
      }),
      listRegistrations: vi.fn(async (consumer) => consumers.get(consumerKey(consumer)) ?? []),
    };
    const logger = createLogger({ quiet: true });
    const ctx: CommandContext = {
      projectRoot: root,
      configPath: path.join(root, "agnos.json"),
      agnosRoot: path.join(root, ".agnos"),
      storeDir,
      logger,
      fetcher: { fetch: vi.fn(), cleanup: vi.fn() } as never,
      linker: createLinker({ probeDir: path.join(root, ".agnos", "tmp"), logger }),
      repositoryTracker: tracker,
      dryRun: false,
      args: ["https://example.test/org/repo.git"],
      flags: { dry: false, once: true, quiet: true, help: false, init: false, yes: true },
    };
    const add = referencesDomain.commands?.["add"];
    const remove = referencesDomain.commands?.["remove"];
    if (!add || !remove) throw new Error("reference add/remove commands are missing");

    await add.run(ctx);
    await add.run(ctx);
    const link = path.join(root, ".agnos", "references", "repo");
    expect(await fs.realpath(link)).toBe(await fs.realpath(selectedDirectory));
    expect(tracker.add).toHaveBeenCalledTimes(2);
    expect((await readConfig(ctx.configPath)).references?.sources?.["repo"]).toEqual(info.request);
    const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
    expect(packageJson.workspaces).toEqual({
      packages: ["packages/*", "!.agnos/references/**"],
      nohoist: ["kept"],
    });
    const workspaceYaml = await fs.readFile(path.join(root, "pnpm-workspace.yaml"), "utf8");
    expect(workspaceYaml).toContain("!.agnos/references/**");
    expect(workspaceYaml).toContain("kept: 1.0.0");
    const gitignore = await fs.readFile(path.join(root, ".gitignore"), "utf8");
    expect(gitignore).toContain("/.agnos/references/");
    expect(gitignore).not.toContain("state.json");

    await remove.run({ ...ctx, args: ["repo"] });
    await expect(fs.lstat(link)).rejects.toMatchObject({ code: "ENOENT" });
    expect(tracker.remove).toHaveBeenCalledOnce();
    expect((await readConfig(ctx.configPath)).references?.sources).toEqual({});
  });
});
