import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { DomainRunOptions, RunContext } from "../../src/core/index.js";
import { createLogger, loadPlugins } from "../../src/core/index.js";
import { startWatch } from "../../src/core/watch.js";

let tmp: string;

const OPTS: DomainRunOptions = { dry: false, once: false, quiet: true, interactive: false };

function ctxFor(root: string): RunContext {
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
    flags: { dry: false, once: false, quiet: true, help: false, init: false, yes: false },
  };
}

const read = (rel: string) => fs.readFile(path.join(tmp, rel), "utf8");
const write = (rel: string, body: string) =>
  fs
    .mkdir(path.dirname(path.join(tmp, rel)), { recursive: true })
    .then(() => fs.writeFile(path.join(tmp, rel), body));

/** Poll until `fn` resolves truthy or the timeout elapses. */
async function waitFor(fn: () => Promise<boolean>, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  for (;;) {
    let ok = false;
    try {
      ok = await fn();
    } catch {
      ok = false;
    }
    if (ok) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-watch-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("startWatch (per-domain watcher tree)", () => {
  it("regenerates the docs index when a doc is created, edited, or removed", async () => {
    await write("agnos.json", JSON.stringify({ schemaVersion: 1, docs: { root: ".docs" } }));
    await write(".docs/one.md", "---\ntitle: One\ndescription: first\n---\nbody\n");

    const registry = await loadPlugins({ projectRoot: tmp, logger: createLogger({ quiet: true }) });
    const ac = new AbortController();
    const done = startWatch(registry, OPTS, ctxFor(tmp), "docs", ac.signal);
    try {
      // initial paint
      await waitFor(async () => (await read(".docs/index.md")).includes("One"));

      // create a second doc → index picks it up
      await write(".docs/two.md", "---\ntitle: Two\ndescription: second\n---\nbody\n");
      await waitFor(async () => (await read(".docs/index.md")).includes("Two"));

      // remove it → index drops it
      await fs.rm(path.join(tmp, ".docs/two.md"));
      await waitFor(async () => !(await read(".docs/index.md")).includes("Two"));
    } finally {
      ac.abort();
      await done;
    }
  });

  it("re-injects a canonical file when a watched rule fragment changes", async () => {
    await write(
      "agnos.json",
      JSON.stringify({ schemaVersion: 1, rules: { files: { "./AGENTS.md": ["./frag/sec.md"] } } }),
    );
    await write("frag/sec.md", "---\ntitle: Security\n---\nv1 body\n");

    const registry = await loadPlugins({ projectRoot: tmp, logger: createLogger({ quiet: true }) });
    const ac = new AbortController();
    const done = startWatch(registry, OPTS, ctxFor(tmp), "rules", ac.signal);
    try {
      await waitFor(async () => (await read("AGENTS.md")).includes("v1 body"));

      // edit the fragment → canonical section updates
      await write("frag/sec.md", "---\ntitle: Security\n---\nv2 body\n");
      await waitFor(async () => {
        const out = await read("AGENTS.md");
        return out.includes("v2 body") && !out.includes("v1 body");
      });
      // heading-delimited, no sentinels
      expect(await read("AGENTS.md")).toContain("## Security");
      expect(await read("AGENTS.md")).not.toContain("<!--");
    } finally {
      ac.abort();
      await done;
    }
  });
});
