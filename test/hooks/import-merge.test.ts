import { describe, it, expect } from "vitest";
import type { AgnosConfig, Logger, ResolveContext } from "@luxia/core";
import hooksPlugin from "../src/index.js";

function silentLogger(): Logger {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    success: () => {},
  };
}

function stubCtx(): ResolveContext {
  return {
    agnosRoot: "/tmp",
    projectRoot: "/tmp",
    cacheDir: "/tmp/cache",
    configPath: "/tmp/agnos.json",
    statePath: "/tmp/state.json",
    logger: silentLogger(),
  } as unknown as ResolveContext;
}

const merge = hooksPlugin.importMerge;
if (!merge) throw new Error("hooks plugin must define importMerge");

describe("hooks importMerge", () => {
  it("merges imported events into an empty registry", async () => {
    const config: AgnosConfig = {};
    const imported = {
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "guard.sh" }] }],
    };
    const changed = await merge(
      imported,
      config,
      { agentId: "codex", interactive: false },
      stubCtx(),
    );
    expect(changed).toBe(true);
    expect(config.hooks?.["PreToolUse"]).toHaveLength(1);
  });

  it("skips structurally-equal groups (no blind overwrite, no duplicates)", async () => {
    const group = { matcher: "Bash", hooks: [{ type: "command", command: "guard.sh" }] };
    const config: AgnosConfig = { hooks: { PreToolUse: [group] } };
    // Same group, keys in a different order — must still dedupe.
    const imported = {
      PreToolUse: [{ hooks: [{ command: "guard.sh", type: "command" }], matcher: "Bash" }],
    };
    const changed = await merge(
      imported,
      config,
      { agentId: "claude-code", interactive: false },
      stubCtx(),
    );
    expect(changed).toBe(false);
    expect(config.hooks?.["PreToolUse"]).toHaveLength(1);
  });

  it("appends a genuinely new group to an existing event", async () => {
    const config: AgnosConfig = {
      hooks: {
        PostToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "fmt.sh" }] }],
      },
    };
    const imported = {
      PostToolUse: [{ matcher: "Write", hooks: [{ type: "command", command: "lint.sh" }] }],
    };
    const changed = await merge(
      imported,
      config,
      { agentId: "codex", interactive: false },
      stubCtx(),
    );
    expect(changed).toBe(true);
    expect(config.hooks?.["PostToolUse"]).toHaveLength(2);
  });

  it("returns false for non-object imports without throwing", async () => {
    const config: AgnosConfig = {};
    const changed = await merge(
      ["bad"],
      config,
      { agentId: "codex", interactive: false },
      stubCtx(),
    );
    expect(changed).toBe(false);
    expect(config.hooks).toBeUndefined();
  });
});
