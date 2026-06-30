import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { type GitSource, type LocalSource, type ParsedSource } from "./source.js";
import { buildCloneUrl, resolveDefaultBranch } from "./commit-resolver.js";

const execFile = promisify(execFileCb);

/** Repo subtree fetched when a source names no in-repo path (whole-repo discovery). */
const DISCOVERY_SUBDIR = "skills";

export interface RepoFetchOptions {
  /** Optional commit SHA (or branch/tag) to fetch. Defaults to provider default branch. */
  ref?: string;
  /** Bypass any cached download; force a fresh fetch. */
  noCache?: boolean;
}

export interface RepoFetchResult {
  /** Absolute path to the fetched tree (the repository root). */
  path: string;
  /** Git ref actually fetched (the explicit ref, or the resolved default branch). */
  ref?: string;
}

export interface RepoFetcher {
  /** Fetch a repository source to a cache-managed directory and return the root path. */
  fetch(source: ParsedSource, opts?: RepoFetchOptions): Promise<RepoFetchResult>;
}

export interface CreateRepoFetcherOptions {
  projectRoot: string;
  cacheDir: string;
}

export function createRepoFetcher(opts: CreateRepoFetcherOptions): RepoFetcher {
  return {
    async fetch(source, fetchOpts) {
      if (source.kind === "local") {
        return { path: source.absolutePath };
      }
      return fetchGit(source, opts, fetchOpts);
    },
  };
}

async function fetchGit(
  source: GitSource,
  cfg: CreateRepoFetcherOptions,
  opts?: RepoFetchOptions,
): Promise<RepoFetchResult> {
  // Only fetch the subtree we actually need: a source's in-repo path when it
  // pins one skill, else the conventional top-level `skills/` for discovery.
  const subdir = source.subPath ?? DISCOVERY_SUBDIR;

  // Explicit override wins, then the source's own ref. With neither, ask the
  // provider for the default branch (ls-remote) so a `main`-only assumption
  // doesn't miss repos that default to `canary`/`develop`/`master`.
  const explicitRef = opts?.ref ?? source.ref;
  const ref = explicitRef ?? (await resolveDefaultBranch(source).catch(() => null)) ?? undefined;

  // Cache is keyed by repo + ref + subtree so discovery and per-skill installs
  // don't clobber each other.
  const cacheKey = hashKey(`${source.canonical}@${ref ?? "HEAD"}@${subdir}`);
  const destDir = path.join(cfg.cacheDir, "repos", cacheKey);

  if (!opts?.noCache && (await dirHasFiles(destDir))) {
    return { path: destDir, ref };
  }

  await fs.rm(destDir, { recursive: true, force: true });
  await fs.mkdir(path.dirname(destDir), { recursive: true });

  await sparseClone(buildCloneUrl(source), destDir, ref, subdir);
  return { path: destDir, ref };
}

/**
 * Clone only `subdir` of a repo at `ref`, downloading just that subtree's blobs.
 * Uses a blobless, shallow clone with a cone-mode sparse-checkout (so `subdir` is
 * matched as a directory path, not a loose pattern — `skills` won't also pull in
 * `.agents/skills`). Falls back to a fetch-by-ref for refs that can't be
 * shallow-cloned by name (e.g. raw SHAs).
 */
async function sparseClone(
  url: string,
  dest: string,
  ref: string | undefined,
  subdir: string,
): Promise<void> {
  const cloneArgs = ["clone", "--no-checkout", "--depth", "1", "--filter=blob:none"];
  if (ref) cloneArgs.push("--branch", ref);
  cloneArgs.push(url, dest);
  try {
    await execFile("git", cloneArgs);
    await execFile("git", ["-C", dest, "sparse-checkout", "set", subdir]);
    await execFile("git", ["-C", dest, "checkout"]);
  } catch (err) {
    if (!ref) throw err;
    // `--branch` only accepts branch/tag names; for a raw commit SHA, init an
    // empty repo, enable sparse-checkout, then fetch + check out that exact ref.
    await fs.rm(dest, { recursive: true, force: true });
    await fs.mkdir(dest, { recursive: true });
    await execFile("git", ["-C", dest, "init", "-q"]);
    await execFile("git", ["-C", dest, "remote", "add", "origin", url]);
    await execFile("git", ["-C", dest, "sparse-checkout", "set", subdir]);
    await execFile("git", [
      "-C",
      dest,
      "fetch",
      "--depth",
      "1",
      "--filter=blob:none",
      "origin",
      ref,
    ]);
    await execFile("git", ["-C", dest, "checkout", "FETCH_HEAD"]);
  }
}

async function dirHasFiles(p: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(p);
    return entries.length > 0;
  } catch {
    return false;
  }
}

function hashKey(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

/**
 * Re-export ParsedSource shapes for convenience.
 */
export type { ParsedSource, GitSource, LocalSource };
