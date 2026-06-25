import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { AgnosConfig, MaterializeContext } from "../../src/core/index.js";
import { createLogger, ensureLink } from "../../src/core/index.js";
import { writeIfChanged } from "../../src/agents/adapters/shared.js";
import claudeCode from "../../src/agents/adapters/claude-code/index.js";
import { renderAgent } from "../../src/domains/agents/index.js";

let tmp: string;
const matCtx = (root: string): MaterializeContext => ({
  agnosRoot: root,
  projectRoot: root,
  cacheDir: path.join(root, ".agnos", "cache"),
  configPath: path.join(root, "agnos.json"),
  statePath: path.join(root, ".agnos", "state.json"),
  logger: createLogger({ quiet: true }),
  fetcher: {} as never,
  linker: {} as never,
  dryRun: false,
  agentId: "claude-code",
  indent: "",
});

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-idem-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("idempotent rendering", () => {
  it("writeIfChanged writes once then skips identical content", async () => {
    const ctx = matCtx(tmp);
    const p = path.join(tmp, "f.txt");
    expect(await writeIfChanged(p, "hello\n", ctx, "f")).toBe(true);
    expect(await fs.readFile(p, "utf8")).toBe("hello\n");
    expect(await writeIfChanged(p, "hello\n", ctx, "f")).toBe(false);
    expect(await writeIfChanged(p, "world\n", ctx, "f")).toBe(true);
  });

  it("renderAgent does not rewrite per-agent files when nothing changed", async () => {
    const config: AgnosConfig = {
      schemaVersion: 1,
      agents: ["claude-code"],
      mcp: [{ name: "gh", command: "npx", args: ["-y", "s"], transport: "stdio" }],
      hooks: [
        { event: "PreToolUse", matcher: "git", type: "command", command: "echo x", message: "m" },
      ],
    };
    const files = [".mcp.json", path.join(".claude", "settings.json")];

    await renderAgent(claudeCode, config, matCtx(tmp)); // run 1
    const past = new Date(2020, 0, 1);
    for (const f of files) await fs.utimes(path.join(tmp, f), past, past);
    const before = await Promise.all(
      files.map((f) => fs.stat(path.join(tmp, f)).then((s) => s.mtimeMs)),
    );

    await renderAgent(claudeCode, config, matCtx(tmp)); // run 2 — should touch nothing
    const after = await Promise.all(
      files.map((f) => fs.stat(path.join(tmp, f)).then((s) => s.mtimeMs)),
    );
    expect(after).toEqual(before);
  });

  it("ensureLink treats an identical existing file as already-linked (copy mode)", async () => {
    const target = path.join(tmp, "canon.md");
    await fs.writeFile(target, "SAME");
    const same = path.join(tmp, "same.md");
    await fs.writeFile(same, "SAME");
    expect((await ensureLink(target, same, {} as never)).kind).toBe("already-linked");

    const diff = path.join(tmp, "diff.md");
    await fs.writeFile(diff, "OTHER");
    await expect(ensureLink(target, diff, {} as never)).rejects.toThrow();
  });
});
