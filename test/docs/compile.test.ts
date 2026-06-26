import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { AgnosConfig, ResolveContext } from "../../src/core/index.js";
import { createLogger } from "../../src/core/index.js";
import { compileDocsIndex, effectiveMetadata } from "../../src/domains/docs/index.js";

let tmp: string;

function ctxFor(root: string): ResolveContext {
  return {
    agnosRoot: root,
    projectRoot: root,
    cacheDir: path.join(root, ".agnos", "cache"),
    configPath: path.join(root, "agnos.json"),
    statePath: path.join(root, ".agnos", "state.json"),
    logger: createLogger({ quiet: true }),
    fetcher: {} as never,
    linker: {} as never,
    dryRun: false,
  };
}

async function doc(rel: string, fm: Record<string, string>, body = "body"): Promise<void> {
  const front = Object.entries(fm)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  const abs = path.join(tmp, ".docs", rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, `---\n${front}\n---\n${body}\n`);
}

const full = (title: string, description: string) => ({
  title,
  description,
  read_when: "always",
  agent_cant: "delete",
});

const readIndex = () => fs.readFile(path.join(tmp, ".docs", "index.md"), "utf8");
const config: AgnosConfig = { schemaVersion: 1, docs: { root: ".docs" } };

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-docs-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("effectiveMetadata", () => {
  it("merges user metadata onto the opinionated defaults", () => {
    const meta = effectiveMetadata({
      schemaVersion: 1,
      docs: { root: ".docs", metadata: { owner: "team" } },
    });
    expect(meta["title"]).toBeDefined(); // default kept
    expect(meta["owner"]).toBe("team"); // user-added
  });
});

describe("compileDocsIndex", () => {
  it("compiles a titled, deterministic index and self-excludes it", async () => {
    await doc("setup.md", full("Setup", "how to set up"));
    await doc("api/auth.md", full("Auth", "authentication"));
    const res = await compileDocsIndex(config, ctxFor(tmp));
    expect(res.written).toBe(true);
    const idx = await readIndex();
    expect(idx.startsWith("---\ntitle: Documentation Index\n---")).toBe(true); // injectable by rules
    expect(idx).toContain("### Overview");
    expect(idx).toContain("[Setup](setup.md): how to set up");
    expect(idx).toContain("### api");
    expect(idx).toContain("[Auth](api/auth.md): authentication");
    // self-exclusion: index.md does not list itself
    expect(idx).not.toContain("[Documentation Index]");
  });

  it("is byte-stable (a second run writes nothing)", async () => {
    await doc("setup.md", full("Setup", "x"));
    const ctx = ctxFor(tmp);
    await compileDocsIndex(config, ctx);
    const first = await readIndex();
    const res = await compileDocsIndex(config, ctx);
    expect(res.written).toBe(false);
    expect(await readIndex()).toBe(first);
  });

  it("warns about missing metadata but still indexes the doc", async () => {
    await doc("partial.md", { title: "Partial" }); // missing description/read_when/agent_cant
    const res = await compileDocsIndex(config, ctxFor(tmp));
    expect(res.missing).toEqual([
      { file: "partial.md", keys: ["description", "read_when", "agent_cant"] },
    ]);
    expect(await readIndex()).toContain("[Partial](partial.md)");
  });
});
