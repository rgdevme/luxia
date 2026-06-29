import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type { GitSource, LocalSource } from "./source.js";

const execFile = promisify(execFileCb);

export interface CommitResolution {
  commit: string | null;
  ref: string;
}

export async function resolveGitCommit(src: GitSource, ref = "HEAD"): Promise<CommitResolution> {
  const sha = await fetchCommit(src, ref);
  return { commit: sha, ref };
}

/**
 * Look up the repository's default branch via the provider API. Returns null
 * when the API responds but exposes no usable branch name; throws on a failed
 * request (callers fetching a repo treat that as "fall back to giget default").
 */
export async function resolveDefaultBranch(src: GitSource): Promise<string | null> {
  const url = buildRepoUrl(src);
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "agnos-cli" },
  });
  if (!res.ok) {
    const body = await safeJson(res);
    const detail = body?.message ?? body?.error ?? `HTTP ${res.status}`;
    throw new Error(
      `Failed to resolve default branch for ${src.canonical} via ${src.provider} API: ${detail}` +
        (res.status === 403 || res.status === 429
          ? " (rate-limited; consider a provider access token for repeated use)"
          : ""),
    );
  }
  const body = (await res.json()) as unknown;
  return extractDefaultBranch(src.provider, body);
}

export async function resolveLocalCommit(src: LocalSource): Promise<CommitResolution> {
  try {
    const { stdout } = await execFile("git", ["rev-parse", "HEAD"], { cwd: src.absolutePath });
    const sha = stdout.trim();
    return { commit: sha || null, ref: "HEAD" };
  } catch {
    return { commit: null, ref: "HEAD" };
  }
}

async function fetchCommit(src: GitSource, ref: string): Promise<string> {
  const url = buildUrl(src, ref);
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "agnos-cli" },
  });
  if (!res.ok) {
    const body = await safeJson(res);
    const detail = body?.message ?? body?.error ?? `HTTP ${res.status}`;
    throw new Error(
      `Failed to resolve ${src.canonical}@${ref} via ${src.provider} API: ${detail}` +
        (res.status === 403 || res.status === 429
          ? " (rate-limited; consider a provider access token for repeated use)"
          : ""),
    );
  }
  const body = (await res.json()) as unknown;
  const sha = extractSha(src.provider, body);
  if (!sha) {
    throw new Error(
      `Could not extract commit SHA from ${src.provider} API response for ${src.canonical}@${ref}`,
    );
  }
  return sha;
}

function buildUrl(src: GitSource, ref: string): string {
  const e = encodeURIComponent;
  switch (src.provider) {
    case "github":
      return `https://api.github.com/repos/${e(src.owner)}/${e(src.repo)}/commits/${e(ref)}`;
    case "gitlab": {
      const projectId = encodeURIComponent(`${src.owner}/${src.repo}`);
      return `https://gitlab.com/api/v4/projects/${projectId}/repository/commits/${e(ref)}`;
    }
    case "bitbucket":
      return `https://api.bitbucket.org/2.0/repositories/${e(src.owner)}/${e(src.repo)}/commit/${e(
        ref,
      )}`;
  }
}

function buildRepoUrl(src: GitSource): string {
  const e = encodeURIComponent;
  switch (src.provider) {
    case "github":
      return `https://api.github.com/repos/${e(src.owner)}/${e(src.repo)}`;
    case "gitlab":
      return `https://gitlab.com/api/v4/projects/${encodeURIComponent(`${src.owner}/${src.repo}`)}`;
    case "bitbucket":
      return `https://api.bitbucket.org/2.0/repositories/${e(src.owner)}/${e(src.repo)}`;
  }
}

function extractDefaultBranch(provider: GitSource["provider"], body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const obj = body as Record<string, unknown>;
  switch (provider) {
    case "github":
    case "gitlab":
      return typeof obj["default_branch"] === "string" ? (obj["default_branch"] as string) : null;
    case "bitbucket": {
      const mainbranch = obj["mainbranch"];
      const name =
        mainbranch && typeof mainbranch === "object"
          ? (mainbranch as Record<string, unknown>)["name"]
          : undefined;
      return typeof name === "string" ? name : null;
    }
  }
}

function extractSha(provider: GitSource["provider"], body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const obj = body as Record<string, unknown>;
  switch (provider) {
    case "github":
      return typeof obj["sha"] === "string" ? (obj["sha"] as string) : null;
    case "gitlab":
      return typeof obj["id"] === "string" ? (obj["id"] as string) : null;
    case "bitbucket":
      return typeof obj["hash"] === "string" ? (obj["hash"] as string) : null;
  }
}

async function safeJson(res: Response): Promise<Record<string, string> | null> {
  try {
    return (await res.json()) as Record<string, string>;
  } catch {
    return null;
  }
}
