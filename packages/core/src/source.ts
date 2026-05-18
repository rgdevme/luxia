import path from "node:path";

export type Provider = "github" | "gitlab" | "bitbucket";

export const SUPPORTED_PROVIDERS: readonly Provider[] = ["github", "gitlab", "bitbucket"];

const PROVIDER_HOSTS: Record<string, Provider> = {
  "github.com": "github",
  "gitlab.com": "gitlab",
  "bitbucket.org": "bitbucket",
};

export interface GitSource {
  kind: "git";
  provider: Provider;
  owner: string;
  repo: string;
  /**
   * Optional in-repo POSIX path to a single skill directory. When undefined,
   * the source refers to the whole repo (discovery flow). When set, the source
   * canonicalizes to `<provider>:<owner>/<repo>/<subPath>` and refers to one
   * specific skill.
   */
  subPath?: string;
  /**
   * Canonical form:
   *   - without subPath: `<provider>:<owner>/<repo>`
   *   - with subPath:    `<provider>:<owner>/<repo>/<subPath>`
   */
  canonical: string;
}

export interface LocalSource {
  kind: "local";
  /** Resolved absolute path on disk. Always points directly at the skill dir or repo root. */
  absolutePath: string;
  /** Canonical form: "file:<rel-to-project>" if inside the project, else "file:<abs>". */
  canonical: string;
}

export type ParsedSource = GitSource | LocalSource;

export interface ParseOptions {
  /** Project root, used to make local-path canonical refs relative when possible. */
  projectRoot: string;
  /** Default provider for bare `owner/repo` input. */
  defaultProvider?: Provider;
}

// Shorthand grammar:
//   owner/repo                       → repo only
//   owner/repo/in/repo/path          → repo + subPath
// Owner and repo must each match the strict identifier shape; subPath segments
// can include dots, hyphens, underscores.
const OWNER_REPO_RE = /^([a-z0-9][a-z0-9._-]*)\/([a-z0-9][a-z0-9._-]*)(?:\/(.+))?$/i;

// SSH grammar — repo only (no in-repo path).
const SSH_RE = /^git@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/;

// HTTPS grammar — owner/repo and an optional trailing path.
// Capture groups: 1=host, 2=owner, 3=repo, 4=remainder (may be empty).
// The remainder is later post-processed to strip `tree/<ref>/` or `blob/<ref>/`.
const HTTPS_RE = /^https?:\/\/([^/]+)\/([^/]+)\/([^/?#]+?)(?:\.git)?(?:\/(.*?))?(?:[?#].*)?$/i;

export function parseSource(input: string, opts: ParseOptions): ParsedSource {
  const raw = input.trim();
  if (!raw) throw new Error("source is empty");

  // Explicit file: scheme — strip and treat as local.
  if (raw.startsWith("file:")) {
    return makeLocal(raw.slice("file:".length), opts.projectRoot);
  }

  // <provider>:<owner>/<repo>[/<subPath>] canonical form (idempotent parsing).
  const colon = raw.indexOf(":");
  if (colon > 0 && !raw.startsWith("git@") && !raw.includes("://")) {
    const scheme = raw.slice(0, colon).toLowerCase();
    if ((SUPPORTED_PROVIDERS as readonly string[]).includes(scheme)) {
      const rest = raw.slice(colon + 1);
      const m = OWNER_REPO_RE.exec(rest);
      if (!m) {
        throw new Error(
          `Invalid ${scheme} source: expected "<owner>/<repo>[/<path>]", got "${rest}"`,
        );
      }
      return makeGit(scheme as Provider, m[1]!, m[2]!, m[3]);
    }
  }

  // SSH form: git@host:owner/repo[.git]
  const ssh = SSH_RE.exec(raw);
  if (ssh) {
    const host = ssh[1]!.toLowerCase();
    const provider = PROVIDER_HOSTS[host];
    if (!provider) {
      throw new Error(
        `Unsupported git host "${host}". Supported: ${Object.keys(PROVIDER_HOSTS).join(", ")}.`,
      );
    }
    return makeGit(provider, ssh[2]!, stripDotGit(ssh[3]!));
  }

  // HTTPS form: https://host/owner/repo[/...]
  const https = HTTPS_RE.exec(raw);
  if (https) {
    const host = https[1]!.toLowerCase();
    const provider = PROVIDER_HOSTS[host];
    if (!provider) {
      throw new Error(
        `Unsupported git host "${host}". Supported: ${Object.keys(PROVIDER_HOSTS).join(", ")}.`,
      );
    }
    const subPath = normalizeHttpsRemainder(https[4]);
    return makeGit(provider, https[2]!, stripDotGit(https[3]!), subPath);
  }

  // Bare shorthand: owner/repo[/path]
  const sh = OWNER_REPO_RE.exec(raw);
  if (sh) {
    const provider = opts.defaultProvider ?? "github";
    return makeGit(provider, sh[1]!, sh[2]!, sh[3]);
  }

  // Local path: anything starting with ./, ../, /, or a Windows drive letter.
  if (looksLikePath(raw)) {
    return makeLocal(raw, opts.projectRoot);
  }

  throw new Error(
    `Cannot parse source "${input}". Expected one of:\n` +
      `  - <owner>/<repo>[/<path>]  (e.g. vercel-labs/agent-skills or vercel-labs/agent-skills/skills/pdf)\n` +
      `  - https://<host>/<owner>/<repo>[/tree/<ref>/<path>]  (github.com, gitlab.com, bitbucket.org)\n` +
      `  - git@<host>:<owner>/<repo>.git\n` +
      `  - ./local/path  or  /abs/path`,
  );
}

/**
 * Composite skill reference parser: requires a sub-path (or a local source
 * pointing at a single skill dir). Used when reading values out of
 * `agnos.json#skills`, where every value must resolve to a concrete skill.
 */
export interface CompositeSkillRef {
  source: ParsedSource;
  /** Always set: for git this is the in-repo path; for local this is "" (the LocalSource IS the skill). */
  subPath: string;
  /** Same as source.canonical — handy alias when iterating agnos.json values. */
  composite: string;
}

export function parseCompositeSkillRef(value: string, opts: ParseOptions): CompositeSkillRef {
  const parsed = parseSource(value, opts);
  if (parsed.kind === "git") {
    if (!parsed.subPath) {
      throw new Error(
        `Invalid skill ref "${value}": missing in-repo path. ` +
          `Expected "<provider>:<owner>/<repo>/<path>", e.g. "github:vercel-labs/agent-skills/skills/pdf".`,
      );
    }
    return { source: parsed, subPath: parsed.subPath, composite: parsed.canonical };
  }
  // Local: the resolved absolute path IS the skill directory.
  return { source: parsed, subPath: "", composite: parsed.canonical };
}

function makeGit(provider: Provider, owner: string, repo: string, subPath?: string): GitSource {
  const cleanSub = normalizeSubPath(subPath);
  const canonical = cleanSub
    ? `${provider}:${owner}/${repo}/${cleanSub}`
    : `${provider}:${owner}/${repo}`;
  return {
    kind: "git",
    provider,
    owner,
    repo,
    ...(cleanSub ? { subPath: cleanSub } : {}),
    canonical,
  };
}

function makeLocal(rawPath: string, projectRoot: string): LocalSource {
  const abs = path.isAbsolute(rawPath) ? rawPath : path.resolve(projectRoot, rawPath);
  const rel = path.relative(projectRoot, abs);
  let canonical: string;
  if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
    const normalized = rel.split(path.sep).join("/");
    canonical = `file:./${normalized}`;
  } else {
    canonical = `file:${abs.split(path.sep).join("/")}`;
  }
  return { kind: "local", absolutePath: abs, canonical };
}

function stripDotGit(repo: string): string {
  return repo.endsWith(".git") ? repo.slice(0, -4) : repo;
}

function looksLikePath(s: string): boolean {
  if (s.startsWith("./") || s.startsWith("../")) return true;
  if (s.startsWith("/")) return true;
  if (/^[A-Za-z]:[\\/]/.test(s)) return true;
  return false;
}

export function isProvider(value: string): value is Provider {
  return (SUPPORTED_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Trim leading/trailing slashes and reject paths containing `..` segments
 * or absolute prefixes. Returns undefined for empty/missing input.
 */
function normalizeSubPath(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!trimmed) return undefined;
  const segments = trimmed.split("/");
  if (segments.some((s) => s === "..")) {
    throw new Error(`Invalid in-repo path "${raw}": must not contain ".."`);
  }
  return segments.join("/");
}

/**
 * For an HTTPS source like https://github.com/owner/repo/tree/main/skills/pdf,
 * `https[4]` captures `tree/main/skills/pdf`. Strip the `tree/<ref>/` or
 * `blob/<ref>/` prefix the GitHub web UI tacks on so the returned path is
 * just the in-repo location.
 */
function normalizeHttpsRemainder(remainder: string | undefined): string | undefined {
  if (!remainder) return undefined;
  const m = /^(?:tree|blob)\/[^/]+\/(.+)$/.exec(remainder);
  return normalizeSubPath(m ? m[1] : remainder);
}
