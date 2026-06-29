import path from "node:path";

export type Provider = "github" | "gitlab" | "bitbucket";

export const SUPPORTED_PROVIDERS: readonly Provider[] = ["github", "gitlab", "bitbucket"];

/**
 * Branch the fetcher falls back to when a source omits a `#<ref>` and the
 * provider's default branch can't be resolved (offline / rate-limited). The
 * normal path infers the real default branch instead — see the resolver.
 */
export const FALLBACK_REF = "main";

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
   * Explicit git ref (branch / tag / commit) from a `#<ref>` suffix. When
   * undefined the source follows the repository's default branch, resolved
   * lazily at fetch time.
   */
  ref?: string;
  /**
   * Canonical form (the `#<ref>` suffix is present only for an explicit ref):
   *   - `<provider>:<owner>/<repo>`                  (follows default branch)
   *   - `<provider>:<owner>/<repo>/<subPath>`        (follows default branch)
   *   - `<provider>:<owner>/<repo>[/<subPath>]#<ref>`
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
  const trimmed = input.trim();
  if (!trimmed) throw new Error("source is empty");

  // Explicit file: scheme — strip and treat as local (refs don't apply locally).
  if (trimmed.startsWith("file:")) {
    return makeLocal(trimmed.slice("file:".length), opts.projectRoot);
  }

  // Peel off an optional trailing `#<ref>` shared by every git form. The base
  // (ref-stripped) string drives form detection; `ref` flows into makeGit.
  const { base: raw, ref } = splitRef(trimmed);

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
      return makeGit(scheme as Provider, m[1]!, m[2]!, m[3], ref);
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
    return makeGit(provider, ssh[2]!, stripDotGit(ssh[3]!), undefined, ref);
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
    // A `/tree/<ref>/` or `/blob/<ref>/` web-UI suffix also encodes a ref; an
    // explicit `#<ref>` takes precedence over it.
    const { subPath, ref: treeRef } = normalizeHttpsRemainder(https[4]);
    return makeGit(provider, https[2]!, stripDotGit(https[3]!), subPath, ref ?? treeRef);
  }

  // Bare shorthand: owner/repo[/path]
  const sh = OWNER_REPO_RE.exec(raw);
  if (sh) {
    const provider = opts.defaultProvider ?? "github";
    return makeGit(provider, sh[1]!, sh[2]!, sh[3], ref);
  }

  // Local path: anything starting with ./, ../, /, or a Windows drive letter.
  // Parse the original (un-split) input so a `#` in a path is preserved.
  if (looksLikePath(trimmed)) {
    return makeLocal(trimmed, opts.projectRoot);
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

function makeGit(
  provider: Provider,
  owner: string,
  repo: string,
  subPath?: string,
  ref?: string,
): GitSource {
  const cleanSub = normalizeSubPath(subPath);
  const base = cleanSub
    ? `${provider}:${owner}/${repo}/${cleanSub}`
    : `${provider}:${owner}/${repo}`;
  // No explicit ref → follow the default branch, kept implicit in the canonical
  // form. An explicit ref (even "main") is preserved, so it pins that branch.
  const canonical = ref ? `${base}#${ref}` : base;
  return {
    kind: "git",
    provider,
    owner,
    repo,
    ...(cleanSub ? { subPath: cleanSub } : {}),
    ...(ref ? { ref } : {}),
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
 * `https[4]` captures `tree/main/skills/pdf`. Split off the `tree/<ref>/` or
 * `blob/<ref>/` prefix the GitHub web UI tacks on, returning both the encoded
 * ref and the in-repo path (either may be absent).
 */
function normalizeHttpsRemainder(remainder: string | undefined): {
  subPath: string | undefined;
  ref: string | undefined;
} {
  if (!remainder) return { subPath: undefined, ref: undefined };
  const m = /^(?:tree|blob)\/([^/]+)(?:\/(.+))?$/.exec(remainder);
  if (m) return { ref: m[1], subPath: normalizeSubPath(m[2]) };
  return { subPath: normalizeSubPath(remainder), ref: undefined };
}

// A git ref permits letters, digits, and `. _ - /` (branches, tags, SHAs).
// We additionally reject `..` and leading/trailing slashes — enough to keep a
// ref from smuggling path traversal or shell-hostile characters downstream.
const REF_RE = /^[a-z0-9][a-z0-9._/-]*$/i;

/** Split a trailing `#<ref>` off a git source string; validates the ref shape. */
function splitRef(raw: string): { base: string; ref: string | undefined } {
  const hash = raw.indexOf("#");
  if (hash < 0) return { base: raw, ref: undefined };
  const base = raw.slice(0, hash);
  const ref = raw.slice(hash + 1).trim();
  if (!ref) {
    throw new Error(`Invalid source "${raw}": "#" must be followed by a git ref`);
  }
  if (!REF_RE.test(ref) || ref.includes("..") || ref.endsWith("/")) {
    throw new Error(
      `Invalid git ref "${ref}" in "${raw}": refs may contain letters, digits, ".", "_", "-", "/".`,
    );
  }
  return { base, ref };
}
