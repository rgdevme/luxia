import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import matter from "gray-matter";
import type { AgnosConfig, LogParts, ResolveContext } from "../../src/core/index.js";
import { createLogger } from "../../src/core/index.js";
import { compileDocsIndex } from "../../src/domains/docs/index.js";

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

async function doc(rel: string, fm: Record<string, unknown>, body = "body"): Promise<void> {
  const abs = path.join(tmp, ".docs", rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, matter.stringify(`${body}\n`, fm));
}

const full = (title: string, description: string) => ({
  type: "Technical Doc",
  title,
  description,
  resource: "",
  tags: [],
  timestamp: "2026-06-30T00:00:00Z",
});

const readIndex = () => fs.readFile(path.join(tmp, ".docs", "index.md"), "utf8");
const config: AgnosConfig = { schemaVersion: 1, docs: { root: ".docs" } };

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-docs-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("compileDocsIndex", () => {
  it("compiles a titled, deterministic index and self-excludes it", async () => {
    await doc("setup.md", full("Setup", "how to set up"));
    await doc("api/auth.md", full("Auth", "authentication"));
    const res = await compileDocsIndex(config, ctxFor(tmp));
    expect(res.written).toBe(true);
    expect(res.incomplete).toEqual([]);
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

  it("treats a doc with empty resource and tags as complete", async () => {
    await doc("ok.md", {
      type: "Doc",
      title: "OK",
      description: "fine",
      resource: "",
      tags: [],
      timestamp: "2026-06-30T00:00:00Z",
    });
    const res = await compileDocsIndex(config, ctxFor(tmp));
    expect(res.incomplete).toEqual([]);
  });

  it("accepts an unquoted ISO timestamp that YAML parses into a Date", async () => {
    const abs = path.join(tmp, ".docs", "dated.md");
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(
      abs,
      `---\ntype: Doc\ntitle: Dated\ndescription: d\nresource: ""\ntags: []\ntimestamp: 2026-06-30T00:00:00Z\n---\nbody\n`,
    );
    const res = await compileDocsIndex(config, ctxFor(tmp));
    expect(res.incomplete).toEqual([]);
  });

  it("reports a doc missing required fields as incomplete but still indexes it", async () => {
    await doc("partial.md", { title: "Partial" }); // missing type/description/resource/tags/timestamp
    const res = await compileDocsIndex(config, ctxFor(tmp));
    expect(res.incomplete).toEqual(["partial.md"]);
    expect(await readIndex()).toContain("[Partial](partial.md)");
  });

  it("reports a doc that omits the resource or tags keys as incomplete", async () => {
    await doc("noresource.md", {
      type: "Doc",
      title: "No resource",
      description: "d",
      tags: [],
      timestamp: "2026-06-30T00:00:00Z",
    });
    await doc("notags.md", {
      type: "Doc",
      title: "No tags",
      description: "d",
      resource: "",
      timestamp: "2026-06-30T00:00:00Z",
    });
    const res = await compileDocsIndex(config, ctxFor(tmp));
    expect(res.incomplete.sort()).toEqual(["noresource.md", "notags.md"]);
  });

  it("excludes reserved index.md and log.md from the scan and the listing", async () => {
    await doc("guide.md", full("Guide", "a guide"));
    await fs.writeFile(
      path.join(tmp, ".docs", "log.md"),
      "# Log\n\n## 2026-06-30\n\n- did a thing\n",
    );
    const res = await compileDocsIndex(config, ctxFor(tmp));
    expect(res.incomplete).toEqual([]); // log.md is not scanned despite having no frontmatter
    const idx = await readIndex();
    expect(idx).not.toContain("log.md");
    expect(idx).not.toContain("index.md");
    expect(idx).toContain("[Guide](guide.md)");
  });

  it("warns with the incomplete-files list", async () => {
    await doc("partial.md", { title: "Partial" });
    const warnings: LogParts[] = [];
    const ctx = ctxFor(tmp);
    ctx.logger = { ...ctx.logger, warn: (m) => warnings.push(m as LogParts) };
    await compileDocsIndex(config, ctx);
    expect(warnings).toHaveLength(1);
    const { message, extra } = warnings[0]!;
    expect(message).toBe("The following files' metadata is incomplete:");
    expect(extra).toContain("- partial.md");
  });
});
