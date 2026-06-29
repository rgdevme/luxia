import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";

// The fetcher clones via `git` (ls-remote + sparse clone) through
// promisify(execFile). Mock the module and simulate the side effects: ls-remote
// reports a default branch; `clone` materializes the requested subtree on disk.
vi.mock("node:child_process", () => ({ execFile: vi.fn() }));

import { createRepoFetcher, parseSource } from "../../src/core/index.js";

const mockExec = vi.mocked(execFile);

/** Record of git invocations as `[file, ...args]` for assertions. */
let calls: string[][] = [];

function installGitMock(): void {
  mockExec.mockImplementation(((...args: unknown[]) => {
    const cb = args[args.length - 1] as (
      e: Error | null,
      r?: { stdout: string; stderr: string },
    ) => void;
    const gitArgs = args[1] as string[];
    calls.push([args[0] as string, ...gitArgs]);
    void (async () => {
      try {
        if (gitArgs[0] === "ls-remote") {
          cb(null, { stdout: "ref: refs/heads/main\tHEAD\n", stderr: "" });
          return;
        }
        if (gitArgs[0] === "clone") {
          // dest is the last positional arg; drop a SKILL.md so the dir is non-empty.
          const dest = gitArgs[gitArgs.length - 1]!;
          await fs.mkdir(path.join(dest, "skills", "demo"), { recursive: true });
          await fs.writeFile(path.join(dest, "skills", "demo", "SKILL.md"), "# Demo\n");
        }
        cb(null, { stdout: "", stderr: "" });
      } catch (e) {
        cb(e as Error);
      }
    })();
  }) as unknown as typeof execFile);
}

describe("createRepoFetcher (sparse git clone)", () => {
  let root: string;

  beforeEach(async () => {
    mockExec.mockReset();
    calls = [];
    installGitMock();
    root = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-resolver-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  function fetcher() {
    return createRepoFetcher({
      projectRoot: root,
      cacheDir: path.join(root, ".agnos", "cache"),
    });
  }

  it("clones only the skills/ subtree at the resolved default branch", async () => {
    const source = parseSource("github:vercel-labs/agent-skills", { projectRoot: root });
    if (source.kind !== "git") throw new Error("expected git source");

    const res = await fetcher().fetch(source);

    expect(res.ref).toBe("main"); // from the mocked ls-remote symref
    await expect(
      fs.access(path.join(res.path, "skills", "demo", "SKILL.md")),
    ).resolves.toBeUndefined();

    const clone = calls.find((c) => c[1] === "clone")!;
    expect(clone).toContain("--filter=blob:none");
    expect(clone).toContain("--branch");
    expect(clone[clone.indexOf("--branch") + 1]).toBe("main");
    expect(clone).toContain("https://github.com/vercel-labs/agent-skills.git");

    const sparse = calls.find((c) => c.includes("sparse-checkout"))!;
    expect(sparse[sparse.length - 1]).toBe("skills");
  });

  it("scopes the clone to the source's in-repo path when one is given", async () => {
    const source = parseSource("github:vercel-labs/agent-skills/skills/pdf", { projectRoot: root });
    if (source.kind !== "git") throw new Error("expected git source");

    await fetcher().fetch(source);
    const sparse = calls.find((c) => c.includes("sparse-checkout"))!;
    expect(sparse[sparse.length - 1]).toBe("skills/pdf");
  });

  it("reuses the cached clone on a second fetch", async () => {
    const source = parseSource("github:vercel-labs/agent-skills", { projectRoot: root });
    if (source.kind !== "git") throw new Error("expected git source");

    await fetcher().fetch(source);
    const clonesAfterFirst = calls.filter((c) => c[1] === "clone").length;
    await fetcher().fetch(source);
    const clonesAfterSecond = calls.filter((c) => c[1] === "clone").length;
    expect(clonesAfterFirst).toBe(1);
    expect(clonesAfterSecond).toBe(1); // no re-clone
  });

  it("re-clones when noCache is set", async () => {
    const source = parseSource("github:vercel-labs/agent-skills", { projectRoot: root });
    if (source.kind !== "git") throw new Error("expected git source");

    await fetcher().fetch(source);
    await fetcher().fetch(source, { noCache: true });
    expect(calls.filter((c) => c[1] === "clone").length).toBe(2);
  });

  it("uses the explicit ref and skips default-branch resolution", async () => {
    const source = parseSource("github:vercel-labs/agent-skills#canary", { projectRoot: root });
    if (source.kind !== "git") throw new Error("expected git source");

    const res = await fetcher().fetch(source);
    expect(res.ref).toBe("canary");
    expect(calls.some((c) => c[1] === "ls-remote")).toBe(false);
    const clone = calls.find((c) => c[1] === "clone")!;
    expect(clone[clone.indexOf("--branch") + 1]).toBe("canary");
  });
});
