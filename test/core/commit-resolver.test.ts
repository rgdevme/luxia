import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";

// commit-resolver shells out to `git` (ls-remote / rev-parse) via
// promisify(execFile). Mock the module so we can drive those calls. The mock
// invokes the trailing callback, matching what promisify expects.
vi.mock("node:child_process", () => ({ execFile: vi.fn() }));

import {
  resolveDefaultBranch,
  resolveGitCommit,
  resolveLocalCommit,
} from "../../src/core/commit-resolver.js";
import type { GitSource, LocalSource } from "../../src/core/source.js";

const mockExec = vi.mocked(execFile);

/** Make every `git` invocation reject (the default for tests that don't use git). */
function gitFails(): void {
  mockExec.mockImplementation(((...args: unknown[]) => {
    (args[args.length - 1] as (e: Error) => void)(new Error("git unavailable"));
  }) as unknown as typeof execFile);
}

/** Make every `git` invocation resolve with the given stdout. */
function gitReturns(stdout: string): void {
  mockExec.mockImplementation(((...args: unknown[]) => {
    (args[args.length - 1] as (e: null, r: { stdout: string; stderr: string }) => void)(null, {
      stdout,
      stderr: "",
    });
  }) as unknown as typeof execFile);
}

beforeEach(() => {
  mockExec.mockReset();
  gitFails();
});

function gitSrc(provider: "github" | "gitlab" | "bitbucket"): GitSource {
  return {
    kind: "git",
    provider,
    owner: "owner",
    repo: "repo",
    canonical: `${provider}:owner/repo`,
  };
}

describe("resolveGitCommit", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    // each test will overwrite
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("hits github API and reads .sha", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ sha: "deadbeef" }),
    })) as unknown as typeof fetch;
    globalThis.fetch = fetchSpy;
    const r = await resolveGitCommit(gitSrc("github"));
    expect(r).toEqual({ commit: "deadbeef", ref: "HEAD" });
    expect((fetchSpy as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(
      "https://api.github.com/repos/owner/repo/commits/HEAD",
    );
  });

  it("hits gitlab API and reads .id", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: "abc123" }),
    })) as unknown as typeof fetch;
    globalThis.fetch = fetchSpy;
    const r = await resolveGitCommit(gitSrc("gitlab"), "main");
    expect(r.commit).toBe("abc123");
    expect((fetchSpy as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(
      "https://gitlab.com/api/v4/projects/owner%2Frepo/repository/commits/main",
    );
  });

  it("hits bitbucket API and reads .hash", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ hash: "feed1234" }),
    })) as unknown as typeof fetch;
    globalThis.fetch = fetchSpy;
    const r = await resolveGitCommit(gitSrc("bitbucket"));
    expect(r.commit).toBe("feed1234");
  });

  it("surfaces a clear error on 404", async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 404,
      json: async () => ({ message: "Not Found" }),
    })) as unknown as typeof fetch;
    await expect(resolveGitCommit(gitSrc("github"))).rejects.toThrow(/Not Found/);
  });

  it("flags rate-limit on 403", async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 403,
      json: async () => ({ message: "rate limit" }),
    })) as unknown as typeof fetch;
    await expect(resolveGitCommit(gitSrc("github"))).rejects.toThrow(/rate-limited/);
  });
});

describe("resolveDefaultBranch", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("resolves the default branch via git ls-remote --symref (no API call)", async () => {
    gitReturns("ref: refs/heads/canary\tHEAD\nfeedface\tHEAD\n");
    const fetchSpy = vi.fn() as unknown as typeof fetch;
    globalThis.fetch = fetchSpy;
    expect(await resolveDefaultBranch(gitSrc("github"))).toBe("canary");
    const call = mockExec.mock.calls[0]!;
    expect(call[0]).toBe("git");
    expect(call[1]).toEqual(["ls-remote", "--symref", "https://github.com/owner/repo.git", "HEAD"]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // The remaining cases exercise the REST-API fallback: the default `gitFails()`
  // mock makes ls-remote throw, so resolution falls through to the provider API.
  it("reads github/gitlab default_branch", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ default_branch: "develop" }),
    })) as unknown as typeof fetch;
    globalThis.fetch = fetchSpy;
    expect(await resolveDefaultBranch(gitSrc("github"))).toBe("develop");
    expect((fetchSpy as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(
      "https://api.github.com/repos/owner/repo",
    );
  });

  it("reads bitbucket mainbranch.name", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ mainbranch: { name: "master" } }),
    })) as unknown as typeof fetch;
    expect(await resolveDefaultBranch(gitSrc("bitbucket"))).toBe("master");
  });

  it("returns null when no branch is exposed", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({}),
    })) as unknown as typeof fetch;
    expect(await resolveDefaultBranch(gitSrc("github"))).toBeNull();
  });

  it("throws on a failed request", async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 404,
      json: async () => ({ message: "Not Found" }),
    })) as unknown as typeof fetch;
    await expect(resolveDefaultBranch(gitSrc("github"))).rejects.toThrow(/Not Found/);
  });
});

describe("resolveLocalCommit", () => {
  it("returns commit null when path isn't a git repo", async () => {
    const src: LocalSource = {
      kind: "local",
      absolutePath: "/this/does/not/exist/agnos-test",
      canonical: "file:./nope",
    };
    const r = await resolveLocalCommit(src);
    expect(r.commit).toBeNull();
    expect(r.ref).toBe("HEAD");
  });
});
