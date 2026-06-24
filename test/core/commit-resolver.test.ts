import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveGitCommit, resolveLocalCommit } from "../src/commit-resolver.js";
import type { GitSource, LocalSource } from "../src/source.js";

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
