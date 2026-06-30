import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { AgnosConfig, ResolveContext } from "../../src/core/index.js";
import { createLogger } from "../../src/core/index.js";
import { injectRules } from "../../src/domains/rules/index.js";

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

async function frag(rel: string, title: string | null, body: string): Promise<void> {
  const fm = title === null ? "" : `---\ntitle: ${title}\n---\n`;
  await fs.mkdir(path.dirname(path.join(tmp, rel)), { recursive: true });
  await fs.writeFile(path.join(tmp, rel), `${fm}${body}\n`);
}

const read = (rel: string) => fs.readFile(path.join(tmp, rel), "utf8");

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-rules-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("injectRules", () => {
  it("injects titled fragments and is idempotent", async () => {
    await frag("frag/sec.md", "Security", "no secrets");
    const config: AgnosConfig = {
      schemaVersion: 1,
      rules: { files: { "./AGENTS.md": ["./frag/sec.md"] } },
    };
    await injectRules(config, ctxFor(tmp));
    const first = await read("AGENTS.md");
    expect(first).toContain("## Security");
    expect(first).not.toContain("<!--"); // heading-delimited, no sentinels
    expect(first).toContain("no secrets");
    // idempotent: a second run leaves the file byte-identical
    await injectRules(config, ctxFor(tmp));
    expect(await read("AGENTS.md")).toBe(first);
  });

  it("preserves hand-written sections and tracks managed slugs in state", async () => {
    await frag("frag/sec.md", "Security", "no secrets");
    const ctx = ctxFor(tmp);
    await fs.writeFile(path.join(tmp, "AGENTS.md"), "# AGENTS\n\nintro\n\n## Manual\n\nkeep me\n");
    const config: AgnosConfig = {
      schemaVersion: 1,
      rules: { files: { "./AGENTS.md": ["./frag/sec.md"] } },
    };
    await injectRules(config, ctx);
    const out = await read("AGENTS.md");
    expect(out).toContain("## Manual");
    expect(out).toContain("keep me");
    expect(out).toContain("## Security");
    // managed slugs are persisted so a later run can prune removed fragments
    const state = JSON.parse(await read(".agnos/state.json")) as {
      rulesSections?: Record<string, string[]>;
    };
    expect(state.rulesSections?.["./AGENTS.md"]).toEqual(["security"]);
  });

  it("fans out one fragment into multiple canonical files", async () => {
    await frag("frag/shared.md", "Shared", "shared body");
    const config: AgnosConfig = {
      schemaVersion: 1,
      rules: {
        files: { "./AGENTS.md": ["./frag/shared.md"], "./api/AGENTS.md": ["./frag/shared.md"] },
      },
    };
    await injectRules(config, ctxFor(tmp));
    expect(await read("AGENTS.md")).toContain("shared body");
    expect(await read("api/AGENTS.md")).toContain("shared body");
  });

  it("skips fragments missing a title but injects the rest", async () => {
    await frag("frag/ok.md", "Ok", "ok body");
    await frag("frag/no-title.md", null, "orphan body");
    const config: AgnosConfig = {
      schemaVersion: 1,
      rules: { files: { "./AGENTS.md": ["./frag/ok.md", "./frag/no-title.md"] } },
    };
    await injectRules(config, ctxFor(tmp));
    const out = await read("AGENTS.md");
    expect(out).toContain("ok body");
    expect(out).not.toContain("orphan body");
  });

  it("skips a duplicate title within the same canonical file", async () => {
    await frag("frag/a.md", "Dup", "first");
    await frag("frag/b.md", "Dup", "second");
    const config: AgnosConfig = {
      schemaVersion: 1,
      rules: { files: { "./AGENTS.md": ["./frag/a.md", "./frag/b.md"] } },
    };
    await injectRules(config, ctxFor(tmp));
    const out = await read("AGENTS.md");
    expect(out).toContain("first");
    expect(out).not.toContain("second");
  });

  it("prunes a section when its fragment is removed from the config", async () => {
    await frag("frag/a.md", "Alpha", "a body");
    await frag("frag/b.md", "Beta", "b body");
    const ctx = ctxFor(tmp);
    await injectRules(
      { schemaVersion: 1, rules: { files: { "./AGENTS.md": ["./frag/a.md", "./frag/b.md"] } } },
      ctx,
    );
    expect(await read("AGENTS.md")).toContain("b body");
    // drop Beta from config → its section is pruned on the next run
    await injectRules(
      { schemaVersion: 1, rules: { files: { "./AGENTS.md": ["./frag/a.md"] } } },
      ctx,
    );
    const out = await read("AGENTS.md");
    expect(out).toContain("a body");
    expect(out).not.toContain("b body");
  });
});
