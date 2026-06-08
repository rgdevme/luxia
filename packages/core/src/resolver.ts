import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { downloadTemplate } from "giget";
import type { GitSource, LocalSource, ParsedSource } from "./source.js";

export interface RepoFetchOptions {
  /** Optional commit SHA (or branch/tag) to fetch. Defaults to provider default branch. */
  ref?: string;
  /** Bypass any cached download; force a fresh fetch. */
  noCache?: boolean;
}

export interface RepoFetchResult {
  /** Absolute path to the fetched tree (the repository root). */
  path: string;
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
  const ref = opts?.ref;
  const cacheKey = hashKey(`${source.canonical}@${ref ?? "HEAD"}`);
  const destDir = path.join(cfg.cacheDir, "repos", cacheKey);
  const cacheRegistry = path.join(cfg.cacheDir, "giget");

  // If we already have a cached fresh copy and the caller didn't ask for noCache, reuse it.
  if (!opts?.noCache && (await dirHasFiles(destDir))) {
    return { path: destDir };
  }

  await fs.rm(destDir, { recursive: true, force: true });
  await fs.mkdir(path.dirname(destDir), { recursive: true });

  if (opts?.noCache) {
    const tarPath = gigetTarballPath(source, ref);
    await fs.rm(tarPath, { force: true });
    await fs.rm(`${tarPath}.json`, { force: true });
  }

  const gigetSource = ref
    ? `${source.provider}:${source.owner}/${source.repo}#${ref}`
    : `${source.provider}:${source.owner}/${source.repo}`;

  await downloadTemplate(gigetSource, {
    dir: destDir,
    force: true,
    forceClean: true,
    install: false,
    offline: false,
    preferOffline: !opts?.noCache,
    cwd: cfg.projectRoot,
    registry: cacheRegistry,
  }).catch(async (err) => {
    // giget cache poisoning workaround: retry once with cache disabled.
    if (opts?.noCache) throw err;
    await downloadTemplate(gigetSource, {
      dir: destDir,
      force: true,
      forceClean: true,
      install: false,
      offline: false,
      preferOffline: false,
      cwd: cfg.projectRoot,
    });
  });

  return { path: destDir };
}

function gigetCacheDir(): string {
  return process.env["XDG_CACHE_HOME"]
    ? path.resolve(process.env["XDG_CACHE_HOME"], "giget")
    : path.resolve(os.homedir(), ".cache/giget");
}

export function gigetTarballPath(source: GitSource, ref: string | undefined): string {
  const name = `${source.owner}-${source.repo}`.replace(/[^\da-z-]/gi, "-");
  const version = ref ?? "main";
  const sourceDir = path.resolve(gigetCacheDir(), source.provider, name);
  const tarPath = path.resolve(sourceDir, `${version}.tar.gz`);
  const rel = path.relative(sourceDir, tarPath);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(
      `Refusing to compute giget tarball path: ref "${ref ?? ""}" escapes source cache dir`,
    );
  }
  return tarPath;
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
