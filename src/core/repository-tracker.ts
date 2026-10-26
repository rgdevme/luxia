import { createHash, randomUUID } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import picomatch from "picomatch";
import type {
  Logger,
  RepositoryConsumer,
  RepositoryRequest,
  RepositoryTrackEntry,
  RepositoryTrackInfo,
  RepositoryTracker,
} from "./types/public.js";

const execFilePromisified = promisify(execFileCallback);
async function execFile(
  executable: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  const invocation = executable === "git" ? ["-c", `core.hooksPath=${os.devNull}`, ...args] : args;
  return await execFilePromisified(executable, invocation, {
    env: { ...process.env, GIT_LFS_SKIP_SMUDGE: "1" },
    windowsHide: true,
  });
}
const CATALOG_VERSION = 1;
const DEFAULT_GLOB = ".";

interface NormalizedRequest {
  source: string;
  repositoryId: string;
  remoteUrl: string;
  branch: string;
  commit?: string;
  glob: string;
  request: RepositoryRequest;
}

interface TrackedRecord {
  request: RepositoryRequest;
  repositoryId: string;
  remoteUrl: string;
  branch: string;
  commit?: string;
  checkoutPath: string;
  consumers: RepositoryConsumer[];
}

interface RepositoryCatalog {
  version: 1;
  records: Record<string, TrackedRecord>;
}

interface TrackerOptions {
  storeDir: string;
  logger?: Logger;
}

export function createRepositoryTracker(options: TrackerOptions): RepositoryTracker {
  const root = path.join(options.storeDir, "repositories");
  const catalogPath = path.join(root, "catalog.json");
  const lockPath = path.join(root, ".lock");

  return {
    async add(request, consumer) {
      return await withLock(lockPath, async () => {
        const catalog = await readCatalog(catalogPath);
        const cached = await findReusableRecord(catalog, request, consumer);
        if (cached) {
          const [trackingId, record] = cached;
          await validateCheckout(record);
          const info = await resolveInfo(trackingId, record);
          if (!record.consumers.some((item) => sameConsumer(item, consumer))) {
            record.consumers.push(consumer);
            await writeCatalog(catalogPath, catalog);
          }
          return info;
        }
        const normalized = await normalizeRequest(request);
        let repositoryPath: string | undefined;
        if (normalized.commit) {
          repositoryPath = getRepositoryPath(root, normalized.remoteUrl, normalized.repositoryId);
          await ensureBareRepository(repositoryPath, normalized.remoteUrl, normalized.branch);
          normalized.commit = await resolveRequestedCommit(repositoryPath, normalized.commit);
          normalized.request.commit = normalized.commit;
        }
        const trackingId = hash(
          `${normalized.repositoryId}\0${normalized.branch}\0${normalized.commit ?? ""}\0${normalized.glob}`,
        );
        let record = catalog.records[trackingId];
        if (!record) {
          repositoryPath ??= getRepositoryPath(root, normalized.remoteUrl, normalized.repositoryId);
          await ensureBareRepository(repositoryPath, normalized.remoteUrl, normalized.branch);
          const checkoutPath = path.join(
            root,
            "checkouts",
            repositoryStorageName(normalized.remoteUrl, normalized.repositoryId),
            checkoutName(normalized.branch, normalized.commit),
          );
          await ensureCheckout(repositoryPath, checkoutPath, normalized.branch, normalized.commit);
          record = {
            request: normalized.request,
            repositoryId: normalized.repositoryId,
            remoteUrl: normalized.remoteUrl,
            branch: normalized.branch,
            ...(normalized.commit ? { commit: normalized.commit } : {}),
            checkoutPath,
            consumers: [],
          };
        }
        await validateCheckout(record);
        const info = await resolveInfo(trackingId, record);
        if (!record.consumers.some((item) => sameConsumer(item, consumer))) {
          record.consumers.push(consumer);
        }
        catalog.records[trackingId] = record;
        await writeCatalog(catalogPath, catalog);
        return info;
      });
    },

    async update(trackingId) {
      return await withLock(lockPath, async () => {
        const catalog = await readCatalog(catalogPath);
        const record = requireRecord(catalog, trackingId);
        if (!record.commit) {
          await validateCheckout(record);
          if (await hasChanges(record.checkoutPath)) {
            throw new Error(`cannot update dirty repository checkout: ${record.checkoutPath}`);
          }
          const current = await resolveCommit(record.checkoutPath);
          const repositoryPath = getRepositoryPath(root, record.remoteUrl, record.repositoryId);
          await ensureBareRepository(repositoryPath, record.remoteUrl, record.branch);
          const { stdout: upstream } = await execFile("git", [
            "--git-dir",
            repositoryPath,
            "rev-parse",
            `refs/remotes/origin/${record.branch}`,
          ]);
          const { stdout: branchState } = await execFile("git", [
            "-C",
            record.checkoutPath,
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
          ]);
          if (branchState.trim() !== `origin/${record.branch}`) {
            throw new Error(
              `repository checkout has an unexpected upstream: ${branchState.trim()}`,
            );
          }
          const ancestor = await isCommitAncestor(record.checkoutPath, current, upstream.trim());
          if (!ancestor) {
            throw new Error(`repository checkout has diverged from origin/${record.branch}`);
          }
          if (current === upstream.trim()) return await resolveInfo(trackingId, record);
          await execFile("git", [
            "-C",
            record.checkoutPath,
            "pull",
            "--ff-only",
            "--no-recurse-submodules",
            "origin",
            record.branch,
          ]);
          if (current === (await resolveCommit(record.checkoutPath)))
            return await resolveInfo(trackingId, record);
        }
        return await resolveInfo(trackingId, record);
      });
    },

    async shouldUpdate(trackingId) {
      return await withLock(lockPath, async () => {
        const catalog = await readCatalog(catalogPath);
        const record = requireRecord(catalog, trackingId);
        if (record.commit) return false;
        await validateCheckout(record);
        const repositoryPath = getRepositoryPath(root, record.remoteUrl, record.repositoryId);
        await ensureBareRepository(repositoryPath, record.remoteUrl, record.branch);
        const { stdout } = await execFile("git", [
          "--git-dir",
          repositoryPath,
          "rev-parse",
          `refs/remotes/origin/${record.branch}`,
        ]);
        return (await resolveCommit(record.checkoutPath)) !== stdout.trim();
      });
    },

    async remove(trackingId, consumer) {
      await withLock(lockPath, async () => {
        const catalog = await readCatalog(catalogPath);
        const record = catalog.records[trackingId];
        if (!record) return;
        record.consumers = record.consumers.filter((item) => !sameConsumer(item, consumer));
        if (record.consumers.length > 0) {
          await writeCatalog(catalogPath, catalog);
          return;
        }

        const dirty = await hasChanges(record.checkoutPath);
        if (dirty) {
          options.logger?.warn(
            `retaining dirty repository checkout after its last consumer was removed: ${record.checkoutPath}`,
          );
          await writeCatalog(catalogPath, catalog);
          return;
        }
        const repositoryPath = getRepositoryPath(root, record.remoteUrl, record.repositoryId);
        catalog.records = Object.fromEntries(
          Object.entries(catalog.records).filter(([id]) => id !== trackingId),
        );
        const checkoutStillUsed = Object.values(catalog.records).some(
          (candidate) => candidate.checkoutPath === record.checkoutPath,
        );
        if (!checkoutStillUsed) {
          await execFile("git", [
            "--git-dir",
            repositoryPath,
            "worktree",
            "remove",
            "--force",
            record.checkoutPath,
          ]);
        }
        const stillUsed = Object.values(catalog.records).some(
          (candidate) => candidate.repositoryId === record.repositoryId,
        );
        if (!stillUsed) await fs.rm(repositoryPath, { recursive: true, force: true });
        await writeCatalog(catalogPath, catalog);
      });
    },

    async listRegistrations(consumer) {
      const catalog = await readCatalog(catalogPath);
      return Object.entries(catalog.records)
        .filter(([, record]) => record.consumers.some((item) => sameConsumer(item, consumer)))
        .map(([trackingId, record]) => ({ trackingId, request: record.request }));
    },
  };
}

async function findReusableRecord(
  catalog: RepositoryCatalog,
  request: RepositoryRequest,
  consumer: RepositoryConsumer,
): Promise<[string, TrackedRecord] | undefined> {
  const parsed = parseRemote(request.source);
  const repositoryId = hash(parsed.identity);
  const glob = normalizeGlob(request.glob ?? parsed.glob ?? DEFAULT_GLOB);
  let candidates = Object.entries(catalog.records).filter(([, record]) => {
    if (record.repositoryId !== repositoryId || (record.request.glob ?? DEFAULT_GLOB) !== glob) {
      return false;
    }
    if (request.branch && record.branch !== request.branch) return false;
    if (parsed.branch && record.branch !== parsed.branch) return false;
    if (request.commit) {
      return record.commit?.startsWith(request.commit.toLowerCase()) ?? false;
    }
    if (record.commit) return false;
    if (request.branch || parsed.branch) return true;
    return true;
  });
  if (!request.branch && !parsed.branch) {
    const owned = candidates.filter(([, record]) =>
      record.consumers.some((item) => sameConsumer(item, consumer)),
    );
    if (owned.length > 0) candidates = owned;
  }
  if (candidates.length !== 1) return undefined;
  const candidate = candidates[0];
  if (!candidate) return undefined;
  if (!(await fs.stat(candidate[1].checkoutPath).catch(() => null))) return undefined;
  return candidate;
}

async function normalizeRequest(request: RepositoryRequest): Promise<NormalizedRequest> {
  const parsed = parseRemote(request.source);
  const branch = request.branch ?? parsed.branch ?? (await resolveDefaultBranch(parsed.remoteUrl));
  if (request.commit && !/^[a-f0-9]{7,64}$/i.test(request.commit)) {
    throw new Error(`invalid commit hash: ${request.commit}`);
  }
  const commit = request.commit?.toLowerCase();
  const glob = normalizeGlob(request.glob ?? parsed.glob ?? DEFAULT_GLOB);
  const normalized: RepositoryRequest = {
    source: parsed.remoteUrl,
    branch,
    ...(commit ? { commit } : {}),
    glob,
  };
  return {
    source: parsed.remoteUrl,
    repositoryId: hash(parsed.identity),
    remoteUrl: parsed.remoteUrl,
    branch,
    ...(commit ? { commit } : {}),
    glob,
    request: normalized,
  };
}

function parseRemote(input: string): {
  remoteUrl: string;
  identity: string;
  branch?: string;
  glob?: string;
} {
  let value = input.trim();
  if (!value) throw new Error("repository source is empty");
  value = value.replace(/^git\+(https|ssh):\/\//i, "$1://");
  let branch: string | undefined;
  let glob: string | undefined;
  const hashIndex = value.lastIndexOf("#");
  if (hashIndex >= 0) {
    branch = value.slice(hashIndex + 1).trim();
    value = value.slice(0, hashIndex);
    if (!branch) throw new Error("repository URL fragment must name a branch or commit");
  }

  const provider = /^(github|gitlab|bitbucket):([^/]+)\/(.+)$/i.exec(value);
  if (provider) {
    const host =
      provider[1]!.toLowerCase() === "github"
        ? "github.com"
        : provider[1]!.toLowerCase() === "gitlab"
          ? "gitlab.com"
          : "bitbucket.org";
    const pieces = provider[3]!.split("/");
    const repo = pieces.shift();
    if (!repo) throw new Error(`invalid repository source: ${input}`);
    if (pieces.length > 0) glob = pieces.join("/");
    const repositoryPath = `${provider[2]}/${stripGitSuffix(repo)}`;
    const remoteUrl = `https://${host}/${repositoryPath}.git`;
    return {
      remoteUrl,
      identity: `${host}/${repositoryPath}`,
      ...(branch ? { branch } : {}),
      ...(glob ? { glob } : {}),
    };
  }

  const scp = /^([^@/:]+@)?([^:/]+):(.+)$/.exec(value);
  if (scp && !value.includes("://")) {
    const host = scp[2]!.toLowerCase();
    const repositoryPath = stripGitSuffix(scp[3]!);
    const remoteUrl = `${scp[1] ?? "git@"}${host}:${repositoryPath}.git`;
    return { remoteUrl, identity: `${host}/${repositoryPath}`, ...(branch ? { branch } : {}) };
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    const shorthand = /^([a-z0-9._-]+)\/([a-z0-9._-]+)(?:\/(.*))?$/i.exec(value);
    if (!shorthand) throw new Error(`invalid repository source: ${input}`, { cause: error });
    const repositoryPath = `${shorthand[1]}/${shorthand[2]}`;
    const remainder = shorthand[3];
    if (remainder) glob = remainder;
    const remoteUrl = `https://github.com/${repositoryPath}.git`;
    return {
      remoteUrl,
      identity: `github.com/${repositoryPath}`,
      ...(branch ? { branch } : {}),
      ...(glob ? { glob } : {}),
    };
  }

  if (url.protocol === "file:") {
    url.search = "";
    url.hash = "";
    const localPath = `${url.host}${decodeURIComponent(url.pathname)}`;
    return {
      remoteUrl: url.toString(),
      identity: `file/${localPath.toLowerCase()}`,
      ...(branch ? { branch } : {}),
    };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:" && url.protocol !== "ssh:") {
    throw new Error(`unsupported repository URL protocol: ${url.protocol}`);
  }
  if (url.protocol !== "ssh:" && (url.username || url.password)) {
    throw new Error(
      "repository URLs must not embed credentials; configure Git credentials instead",
    );
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 1) throw new Error(`repository URL has no repository path: ${input}`);
  if (segments.includes("tree") || segments.includes("blob")) {
    const marker = segments.findIndex((segment) => segment === "tree" || segment === "blob");
    const prefix = segments.slice(0, marker);
    const ref = segments[marker + 1];
    if (ref) branch ??= ref;
    const remainder = segments.slice(marker + 2);
    if (remainder.length > 0) glob = remainder.join("/");
    url.pathname = `/${prefix.join("/")}`;
  } else {
    // For clone URLs, keep their full path. For browser URLs with no marker,
    // the last path segment is the repository, including nested namespaces.
    const last = segments.at(-1)!;
    url.pathname = `/${segments.join("/")}`;
    if (!last.endsWith(".git") && url.pathname.endsWith("/"))
      url.pathname = url.pathname.slice(0, -1);
  }
  url.search = "";
  url.hash = "";
  const remoteUrl = stripRemoteSuffix(url.toString());
  const identity = `${url.host.toLowerCase()}/${stripGitSuffix(url.pathname).replace(/^\//, "")}`;
  return { remoteUrl, identity, ...(branch ? { branch } : {}), ...(glob ? { glob } : {}) };
}

async function resolveDefaultBranch(remoteUrl: string): Promise<string> {
  const { stdout } = await execFile("git", ["ls-remote", "--symref", remoteUrl, "HEAD"]);
  const match = /^ref:\s+refs\/heads\/(\S+)\s+HEAD/m.exec(stdout);
  if (!match?.[1]) throw new Error(`could not resolve the default branch for ${remoteUrl}`);
  return match[1];
}

async function resolveRequestedCommit(repositoryPath: string, requested: string): Promise<string> {
  if (!/^[a-f0-9]{7,64}$/i.test(requested)) throw new Error(`invalid commit hash: ${requested}`);
  const { stdout } = await execFile("git", [
    "--git-dir",
    repositoryPath,
    "rev-parse",
    "--verify",
    `${requested}^{commit}`,
  ]);
  return stdout.trim();
}

async function ensureBareRepository(
  repositoryPath: string,
  remoteUrl: string,
  branch: string,
): Promise<void> {
  if (!(await fs.stat(repositoryPath).catch(() => null))) {
    await fs.mkdir(path.dirname(repositoryPath), { recursive: true });
    const temporary = `${repositoryPath}.${randomUUID().slice(0, 8)}.tmp`;
    try {
      await execFile("git", ["clone", "--bare", "--no-recurse-submodules", remoteUrl, temporary]);
      await execFile("git", [
        "--git-dir",
        temporary,
        "config",
        "remote.origin.fetch",
        "+refs/heads/*:refs/remotes/origin/*",
      ]);
      await execFile("git", [
        "--git-dir",
        temporary,
        "fetch",
        "--prune",
        "--no-recurse-submodules",
        "origin",
      ]);
      await fs.rename(temporary, repositoryPath);
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  } else {
    await execFile("git", ["--git-dir", repositoryPath, "remote", "set-url", "origin", remoteUrl]);
    await execFile("git", [
      "--git-dir",
      repositoryPath,
      "fetch",
      "--prune",
      "--no-recurse-submodules",
      "origin",
    ]);
  }
  const branchExists = await execFile("git", [
    "--git-dir",
    repositoryPath,
    "show-ref",
    "--verify",
    `refs/remotes/origin/${branch}`,
  ])
    .then(() => true)
    .catch(() => false);
  if (!branchExists) throw new Error(`branch "${branch}" not found in ${remoteUrl}`);
}

async function ensureCheckout(
  repositoryPath: string,
  checkoutPath: string,
  branch: string,
  pinnedCommit?: string,
): Promise<void> {
  if (await fs.stat(checkoutPath).catch(() => null)) return;
  await fs.mkdir(path.dirname(checkoutPath), { recursive: true });
  if (pinnedCommit) {
    await execFile("git", [
      "--git-dir",
      repositoryPath,
      "worktree",
      "add",
      "--detach",
      checkoutPath,
      pinnedCommit,
    ]);
    return;
  }
  const branchName = `agnos/${hash(branch).slice(0, 12)}`;
  const localBranchExists = await execFile("git", [
    "--git-dir",
    repositoryPath,
    "show-ref",
    "--verify",
    `refs/heads/${branchName}`,
  ])
    .then(() => true)
    .catch(() => false);
  if (localBranchExists) {
    await execFile("git", [
      "--git-dir",
      repositoryPath,
      "worktree",
      "add",
      checkoutPath,
      branchName,
    ]);
  } else {
    await execFile("git", [
      "--git-dir",
      repositoryPath,
      "worktree",
      "add",
      "-b",
      branchName,
      "--track",
      checkoutPath,
      `origin/${branch}`,
    ]);
  }
  await execFile("git", ["-C", checkoutPath, "branch", "--set-upstream-to", `origin/${branch}`]);
}

async function resolveInfo(
  trackingId: string,
  record: TrackedRecord,
): Promise<RepositoryTrackInfo> {
  const commit = await resolveCommit(record.checkoutPath);
  const entries = await resolveEntries(record.checkoutPath, record.request.glob ?? DEFAULT_GLOB);
  if (entries.length === 0) {
    throw new Error(
      `repository selection matches no content: ${record.request.glob ?? DEFAULT_GLOB}`,
    );
  }
  return {
    trackingId,
    repositoryId: record.repositoryId,
    request: record.request,
    branch: record.branch,
    commit,
    checkoutPath: record.checkoutPath,
    entries,
  };
}

async function resolveEntries(root: string, glob: string): Promise<RepositoryTrackEntry[]> {
  const normalized = normalizeGlob(glob);
  const pattern =
    normalized === "." ? null : picomatch(normalized, { dot: true, posixSlashes: true });
  const entries: RepositoryTrackEntry[] = [];
  async function walk(directory: string): Promise<void> {
    const children = await fs.readdir(directory, { withFileTypes: true });
    for (const child of children) {
      if (child.isSymbolicLink() || child.name === ".git") continue;
      const absolutePath = path.join(directory, child.name);
      const relative = path.relative(root, absolutePath).split(path.sep).join("/");
      const kind = child.isDirectory() ? "directory" : child.isFile() ? "file" : undefined;
      if (!kind) continue;
      if (!pattern || pattern(relative)) entries.push({ path: relative, absolutePath, kind });
      if (child.isDirectory() && !child.name.startsWith(".git")) await walk(absolutePath);
    }
  }
  if (normalized === ".") return [{ path: ".", absolutePath: root, kind: "directory" }];
  await walk(root);
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

async function resolveCommit(directory: string): Promise<string> {
  const { stdout } = await execFile("git", ["-C", directory, "rev-parse", "HEAD"]);
  return stdout.trim();
}

async function isCommitAncestor(
  directory: string,
  commit: string,
  upstream: string,
): Promise<boolean> {
  try {
    await execFile("git", ["-C", directory, "merge-base", "--is-ancestor", commit, upstream]);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException & { code?: number }).code === 1) return false;
    throw error;
  }
}

async function validateCheckout(record: TrackedRecord): Promise<void> {
  const topLevel = await execFile("git", [
    "-C",
    record.checkoutPath,
    "rev-parse",
    "--show-toplevel",
  ]);
  if (path.resolve(topLevel.stdout.trim()) !== path.resolve(record.checkoutPath)) {
    throw new Error(`repository checkout path is unexpected: ${record.checkoutPath}`);
  }
  const head = await resolveCommit(record.checkoutPath);
  if (record.commit && head !== record.commit) {
    throw new Error(`pinned repository checkout moved from ${record.commit} to ${head}`);
  }
  if (!record.commit) {
    const branch = await execFile("git", ["-C", record.checkoutPath, "branch", "--show-current"]);
    const expected = `agnos/${hash(record.branch).slice(0, 12)}`;
    if (branch.stdout.trim() !== expected) {
      throw new Error(`repository checkout is on an unexpected branch: ${branch.stdout.trim()}`);
    }
  }
}

async function hasChanges(directory: string): Promise<boolean> {
  const { stdout } = await execFile("git", ["-C", directory, "status", "--porcelain"]);
  return stdout.trim().length > 0;
}

function normalizeGlob(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "");
  if (normalized === "" || normalized === ".") return ".";
  if (
    normalized.startsWith("/") ||
    /^[a-z]:/i.test(normalized) ||
    normalized.split("/").includes("..")
  ) {
    throw new Error(`repository glob must stay inside the checkout: ${value}`);
  }
  return normalized;
}

function stripGitSuffix(value: string): string {
  return value.replace(/\.git$/i, "").replace(/\/$/, "");
}

function stripRemoteSuffix(value: string): string {
  return `${stripGitSuffix(value)}.git`;
}

function checkoutName(branch: string, commit?: string): string {
  const readable = branch.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 48) || "branch";
  return `${readable}-${hash(branch).slice(0, 10)}${commit ? `-${commit}` : ""}`;
}

function getRepositoryPath(root: string, remoteUrl: string, repositoryId: string): string {
  return path.join(root, "repos", repositoryStorageName(remoteUrl, repositoryId));
}

function repositoryStorageName(remoteUrl: string, repositoryId: string): string {
  void remoteUrl;
  return `repository-${repositoryId.slice(0, 24)}`;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sameConsumer(left: RepositoryConsumer, right: RepositoryConsumer): boolean {
  return (
    left.projectId === right.projectId && left.domain === right.domain && left.name === right.name
  );
}

function requireRecord(catalog: RepositoryCatalog, trackingId: string): TrackedRecord {
  const record = catalog.records[trackingId];
  if (!record) throw new Error(`unknown repository tracking id: ${trackingId}`);
  return record;
}

async function readCatalog(file: string): Promise<RepositoryCatalog> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as RepositoryCatalog;
    if (parsed.version !== CATALOG_VERSION || !parsed.records)
      throw new Error("unsupported repository catalog");
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { version: CATALOG_VERSION, records: {} };
    throw error;
  }
}

async function writeCatalog(file: string, catalog: RepositoryCatalog): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

async function withLock<T>(lockPath: string, operation: () => Promise<T>): Promise<T> {
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 6000; attempt += 1) {
    try {
      await fs.mkdir(lockPath);
      await fs.writeFile(
        path.join(lockPath, "owner.json"),
        JSON.stringify({ pid: process.pid, createdAt: Date.now() }),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await removeStaleLock(lockPath);
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      continue;
    }
    try {
      return await operation();
    } finally {
      await fs.rm(lockPath, { recursive: true, force: true });
    }
  }
  throw new Error(`timed out waiting for repository store lock at ${lockPath}`);
}

async function removeStaleLock(lockPath: string): Promise<void> {
  let owner: { pid?: number; createdAt?: number };
  try {
    owner = JSON.parse(
      await fs.readFile(path.join(lockPath, "owner.json"), "utf8"),
    ) as typeof owner;
  } catch {
    const stat = await fs.stat(lockPath).catch(() => null);
    if (stat && Date.now() - stat.mtimeMs > 30_000) {
      await fs.rm(lockPath, { recursive: true, force: true });
    }
    return;
  }
  if (!owner.pid || !Number.isInteger(owner.pid)) {
    await fs.rm(lockPath, { recursive: true, force: true });
    return;
  }
  try {
    process.kill(owner.pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      await fs.rm(lockPath, { recursive: true, force: true });
    }
  }
}
