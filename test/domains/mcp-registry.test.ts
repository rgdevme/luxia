import { describe, it, expect } from "vitest";
import {
  dedupeName,
  getServerLatest,
  isNewer,
  localNameFor,
  searchServers,
  toDeclarations,
  type RegistryServer,
} from "../../src/domains/mcp/registry.js";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "test",
    json: async () => body,
  } as Response;
}

function fakeFetch(...responses: Response[]): { fetch: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  let i = 0;
  const fetch = (async (url: string) => {
    urls.push(url);
    return responses[Math.min(i++, responses.length - 1)]!;
  }) as unknown as typeof fetch;
  return { fetch, urls };
}

describe("registry — toDeclarations", () => {
  it("maps an npm package to an npx -y stdio command with env placeholders", () => {
    const server: RegistryServer = {
      name: "io.github.acme/weather",
      title: "Weather",
      description: "Weather data",
      version: "1.2.3",
      packages: [
        {
          registryType: "npm",
          identifier: "@acme/weather",
          version: "1.2.3",
          transport: { type: "stdio" },
          environmentVariables: [{ name: "API_KEY", isRequired: true, isSecret: true }],
          packageArguments: [{ type: "positional", value: "--verbose" }],
        },
      ],
    };
    const [decl] = toDeclarations(server).map((c) => c.build());
    expect(decl).toEqual({
      name: "weather",
      source: "io.github.acme/weather",
      version: "1.2.3",
      command: "npx",
      transport: "stdio",
      args: ["-y", "@acme/weather@1.2.3", "--verbose"],
      env: { API_KEY: "" },
    });
  });

  it("maps a pypi package to uvx and honors runtimeHint over the registry default", () => {
    const server: RegistryServer = {
      name: "io.github.acme/pytool",
      version: "0.4.0",
      packages: [
        {
          registryType: "pypi",
          identifier: "pytool",
          version: "0.4.0",
          transport: { type: "stdio" },
        },
      ],
    };
    const [decl] = toDeclarations(server).map((c) => c.build());
    expect(decl.command).toBe("uvx");
    expect(decl.args).toEqual(["pytool@0.4.0"]);
  });

  it("maps an oci package to docker with runtime arguments and no version pin", () => {
    const server: RegistryServer = {
      name: "io.github.acme/dockerized",
      version: "2.0.0",
      packages: [
        {
          registryType: "oci",
          identifier: "acme/server",
          version: "2.0.0",
          runtimeHint: "docker",
          runtimeArguments: [
            { type: "positional", value: "run" },
            { type: "positional", value: "-i" },
            { type: "named", name: "--rm" },
          ],
          transport: { type: "stdio" },
        },
      ],
    };
    const [decl] = toDeclarations(server).map((c) => c.build());
    expect(decl.command).toBe("docker");
    expect(decl.args).toEqual(["run", "-i", "--rm", "acme/server"]);
  });

  it("maps a streamable-http remote to an http decl carrying header placeholders", () => {
    const server: RegistryServer = {
      name: "io.github.acme/hosted",
      version: "1.0.0",
      remotes: [
        {
          type: "streamable-http",
          url: "https://mcp.acme.com/sse",
          headers: [{ name: "Authorization", isSecret: true }],
        },
      ],
    };
    const [decl] = toDeclarations(server).map((c) => c.build());
    expect(decl).toEqual({
      name: "hosted",
      source: "io.github.acme/hosted",
      version: "1.0.0",
      command: "https://mcp.acme.com/sse",
      transport: "http",
      headers: { Authorization: "" },
    });
  });

  it("maps an sse remote to an sse decl", () => {
    const server: RegistryServer = {
      name: "io.github.acme/streamed",
      version: "1.0.0",
      remotes: [{ type: "sse", url: "https://mcp.acme.com/sse" }],
    };
    const [decl] = toDeclarations(server).map((c) => c.build());
    expect(decl.transport).toBe("sse");
    expect(decl.command).toBe("https://mcp.acme.com/sse");
  });

  it("offers one candidate per package and remote", () => {
    const server: RegistryServer = {
      name: "ns/multi",
      version: "1.0.0",
      packages: [{ registryType: "npm", identifier: "a", transport: { type: "stdio" } }],
      remotes: [{ type: "sse", url: "https://x" }],
    };
    expect(toDeclarations(server)).toHaveLength(2);
  });
});

describe("registry — name helpers", () => {
  it("derives a clean local name from a reverse-DNS server name", () => {
    expect(localNameFor("io.github.user/weather")).toBe("weather");
    expect(localNameFor("io.github.user/server_filesystem")).toBe("server-filesystem");
    expect(localNameFor("solo")).toBe("solo");
  });

  it("dedupes against taken names with a numeric suffix", () => {
    const taken = new Set(["weather", "weather-2"]);
    expect(dedupeName("weather", taken)).toBe("weather-3");
    expect(dedupeName("fresh", taken)).toBe("fresh");
  });
});

describe("registry — isNewer", () => {
  it("compares numeric semver segments", () => {
    expect(isNewer("1.2.4", "1.2.3")).toBe(true);
    expect(isNewer("1.3.0", "1.2.9")).toBe(true);
    expect(isNewer("2.0.0", "1.9.9")).toBe(true);
    expect(isNewer("1.2.3", "1.2.3")).toBe(false);
    expect(isNewer("1.2.3", "1.2.4")).toBe(false);
  });

  it("ignores prerelease/build suffixes and a leading v", () => {
    expect(isNewer("v1.2.3", "1.2.3")).toBe(false);
    expect(isNewer("1.2.3-beta.1", "1.2.3")).toBe(false);
  });
});

describe("registry — searchServers", () => {
  function entry(name: string, status?: string): unknown {
    return {
      server: { name, version: "1.0.0" },
      _meta: { "io.modelcontextprotocol.registry/official": { status: status ?? "active" } },
    };
  }

  it("follows nextCursor and drops non-active entries", async () => {
    const { fetch, urls } = fakeFetch(
      jsonResponse({
        servers: [entry("a"), entry("dep", "deprecated")],
        metadata: { count: 2, nextCursor: "c2" },
      }),
      jsonResponse({ servers: [entry("b")], metadata: { count: 1 } }),
    );
    const out = await searchServers("x", { fetch, base: "https://reg.test" });
    expect(out.map((s) => s.name)).toEqual(["a", "b"]);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("search=x");
    expect(urls[0]).toContain("version=latest");
    expect(urls[1]).toContain("cursor=c2");
  });

  it("throws on a non-ok response", async () => {
    const { fetch } = fakeFetch(jsonResponse({}, 500));
    await expect(searchServers("x", { fetch, base: "https://reg.test" })).rejects.toThrow(
      /registry search failed/,
    );
  });
});

describe("registry — getServerLatest", () => {
  it("returns the server for a 200 and url-encodes the name", async () => {
    const { fetch, urls } = fakeFetch(jsonResponse({ server: { name: "ns/x", version: "9.9.9" } }));
    const out = await getServerLatest("ns/x", { fetch, base: "https://reg.test" });
    expect(out?.version).toBe("9.9.9");
    expect(urls[0]).toContain("ns%2Fx");
    expect(urls[0]).toContain("/versions/latest");
  });

  it("returns undefined for a 404", async () => {
    const { fetch } = fakeFetch(jsonResponse({}, 404));
    expect(await getServerLatest("gone/x", { fetch, base: "https://reg.test" })).toBeUndefined();
  });
});
