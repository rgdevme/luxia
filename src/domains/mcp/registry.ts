import type { McpDeclaration } from "../../core/index.js";

/** Default base URL of the official MCP registry; override with `AGNOS_MCP_REGISTRY`. */
export const REGISTRY_BASE =
  process.env["AGNOS_MCP_REGISTRY"] ?? "https://registry.modelcontextprotocol.io";

/** Stop runaway pagination — 10 pages × 100 = 1000 results is far past any useful search. */
const MAX_PAGES = 10;

const RUNTIME_BY_REGISTRY: Record<string, string> = {
  npm: "npx",
  pypi: "uvx",
  oci: "docker",
  nuget: "dnx",
};

export interface RegistryOptions {
  /** Injectable fetch for tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
  base?: string;
}

interface KeyValueInput {
  name?: string;
  value?: string;
  default?: string;
  isRequired?: boolean;
  isSecret?: boolean;
}

interface RegistryArgument {
  type: string;
  name?: string;
  value?: string;
  default?: string;
}

interface RegistryTransport {
  type: string;
  url?: string;
  headers?: KeyValueInput[];
}

interface RegistryPackage {
  registryType: string;
  identifier: string;
  version?: string;
  runtimeHint?: string;
  runtimeArguments?: RegistryArgument[];
  packageArguments?: RegistryArgument[];
  environmentVariables?: KeyValueInput[];
  transport?: RegistryTransport;
}

export interface RegistryServer {
  name: string;
  title?: string;
  description?: string;
  version: string;
  packages?: RegistryPackage[];
  remotes?: RegistryTransport[];
}

interface ServerResponse {
  server: RegistryServer;
  _meta?: {
    "io.modelcontextprotocol.registry/official"?: { status?: string; isLatest?: boolean };
  };
}

interface ServerListResponse {
  servers?: ServerResponse[];
  metadata?: { count: number; nextCursor?: string };
}

/** A way to deploy a registry server (one per declared package or remote). */
export interface DeploymentCandidate {
  label: string;
  build(): McpDeclaration;
}

function isActive(entry: ServerResponse): boolean {
  const status = entry._meta?.["io.modelcontextprotocol.registry/official"]?.status;
  return !status || status === "active";
}

/** Search the registry by name substring, following pagination. Drops non-active entries. */
export async function searchServers(
  term: string,
  opts?: RegistryOptions,
): Promise<RegistryServer[]> {
  const base = opts?.base ?? REGISTRY_BASE;
  const doFetch = opts?.fetch ?? fetch;
  const out: RegistryServer[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL("/v0/servers", base);
    url.searchParams.set("search", term);
    url.searchParams.set("version", "latest");
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await doFetch(url.toString());
    if (!res.ok) throw new Error(`registry search failed: ${res.status} ${res.statusText}`);
    const body = (await res.json()) as ServerListResponse;
    for (const entry of body.servers ?? []) {
      if (isActive(entry)) out.push(entry.server);
    }
    cursor = body.metadata?.nextCursor;
    if (!cursor) break;
  }
  return out;
}

/** Fetch the latest version of a single server by its registry name, or undefined if gone. */
export async function getServerLatest(
  name: string,
  opts?: RegistryOptions,
): Promise<RegistryServer | undefined> {
  const base = opts?.base ?? REGISTRY_BASE;
  const doFetch = opts?.fetch ?? fetch;
  const url = new URL(`/v0/servers/${encodeURIComponent(name)}/versions/latest`, base);
  const res = await doFetch(url.toString());
  if (res.status === 404) return undefined;
  if (!res.ok)
    throw new Error(`registry lookup failed for "${name}": ${res.status} ${res.statusText}`);
  const body = (await res.json()) as ServerResponse;
  return body.server;
}

function argValues(args?: RegistryArgument[]): string[] {
  const out: string[] = [];
  for (const a of args ?? []) {
    const value = a.value ?? a.default;
    if (a.type === "named" && a.name) {
      out.push(a.name);
      if (value) out.push(value);
    } else if (value) {
      out.push(value);
    }
  }
  return out;
}

function envFrom(vars?: KeyValueInput[]): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const v of vars ?? []) {
    if (v.name) out[v.name] = v.value ?? v.default ?? "";
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function packageSpec(pkg: RegistryPackage): string {
  const pinnable = pkg.registryType === "npm" || pkg.registryType === "pypi";
  return pinnable && pkg.version ? `${pkg.identifier}@${pkg.version}` : pkg.identifier;
}

function buildPackageDecl(server: RegistryServer, pkg: RegistryPackage): McpDeclaration {
  const command = pkg.runtimeHint ?? RUNTIME_BY_REGISTRY[pkg.registryType] ?? pkg.registryType;
  const runtimeArgs = argValues(pkg.runtimeArguments);
  // npx needs `-y` to run an uninstalled package without an interactive prompt.
  if (command === "npx" && !runtimeArgs.some((a) => a === "-y" || a === "--yes")) {
    runtimeArgs.unshift("-y");
  }
  const args = [...runtimeArgs, packageSpec(pkg), ...argValues(pkg.packageArguments)];
  const decl: McpDeclaration = {
    name: localNameFor(server.name),
    source: server.name,
    version: server.version,
    command,
    transport: "stdio",
  };
  if (args.length > 0) decl.args = args;
  const env = envFrom(pkg.environmentVariables);
  if (env) decl.env = env;
  return decl;
}

function buildRemoteDecl(server: RegistryServer, remote: RegistryTransport): McpDeclaration {
  const transport = remote.type === "sse" ? "sse" : "http";
  const decl: McpDeclaration = {
    name: localNameFor(server.name),
    source: server.name,
    version: server.version,
    command: remote.url ?? "",
    transport,
  };
  const headers = envFrom(remote.headers);
  if (headers) decl.headers = headers;
  return decl;
}

/** Enumerate the deployment options a registry server offers (packages first, then remotes). */
export function toDeclarations(server: RegistryServer): DeploymentCandidate[] {
  const candidates: DeploymentCandidate[] = [];
  for (const pkg of server.packages ?? []) {
    candidates.push({
      label: `${pkg.registryType} · ${pkg.identifier}`,
      build: () => buildPackageDecl(server, pkg),
    });
  }
  for (const remote of server.remotes ?? []) {
    candidates.push({
      label: `${remote.type} · ${remote.url ?? ""}`.trimEnd(),
      build: () => buildRemoteDecl(server, remote),
    });
  }
  return candidates;
}

/** Derive a short, filesystem-friendly local key from a reverse-DNS registry name. */
export function localNameFor(registryName: string): string {
  const slash = registryName.lastIndexOf("/");
  const segment = slash >= 0 ? registryName.slice(slash + 1) : registryName;
  const cleaned = segment
    .replace(/[^a-zA-Z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return cleaned || "server";
}

/** Return `base`, or `base-2`, `base-3`, … until one is not already taken. */
export function dedupeName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function versionParts(v: string): number[] {
  const main = v.replace(/^v/, "").split(/[-+]/)[0] ?? "";
  return main.split(".").map((s) => {
    const n = parseInt(s, 10);
    return Number.isNaN(n) ? 0 : n;
  });
}

/** True when `a` is a strictly newer version than `b` (numeric semver; prerelease tags ignored). */
export function isNewer(a: string, b: string): boolean {
  const pa = versionParts(a);
  const pb = versionParts(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}
