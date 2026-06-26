import { describe, it, expect } from "vitest";
import type { HookEntry, McpDeclaration } from "../../src/core/index.js";
import { mcpIdentity, mergeMcp, removeMcp } from "../../src/domains/mcp/index.js";
import { hookIdentity, mergeHooks, removeHookById } from "../../src/domains/hooks/index.js";

describe("mcp domain — identity merge", () => {
  const existing: McpDeclaration[] = [
    { name: "fs", command: "npx", args: ["a"] },
    { name: "db", command: "db-server" },
  ];

  it("keys identity on name", () => {
    expect(mcpIdentity({ name: "fs", command: "x" })).toBe("fs");
  });

  it("missing adds only new names; force overwrites a changed payload; skip aborts", () => {
    const discovered: McpDeclaration[] = [
      { name: "fs", command: "npx", args: ["CHANGED"] }, // conflict (same name, diff payload)
      { name: "web", command: "web-server" }, // new
    ];
    const missing = mergeMcp(existing, discovered, "missing");
    expect(missing.added).toBe(1);
    expect(missing.overwritten).toBe(0);
    expect(missing.items.find((m) => m.name === "fs")?.args).toEqual(["a"]); // untouched

    const force = mergeMcp(existing, discovered, "force");
    expect(force.overwritten).toBe(1);
    expect(force.items.find((m) => m.name === "fs")?.args).toEqual(["CHANGED"]);

    const skip = mergeMcp(existing, discovered, "skip");
    expect(skip.aborted).toBe(true);
    expect(skip.items).toEqual(existing);
  });

  it("identical discovered payload is not a conflict", () => {
    const r = mergeMcp(existing, [{ name: "fs", command: "npx", args: ["a"] }], "skip");
    expect(r.aborted).toBe(false);
    expect(r.conflicts).toBe(0);
  });

  it("removes by name", () => {
    expect(removeMcp(existing, "fs").map((m) => m.name)).toEqual(["db"]);
  });
});

describe("hooks domain — identity merge", () => {
  const existing: HookEntry[] = [
    { event: "PreToolUse", matcher: "git", type: "command", command: "echo a" },
    { event: "SessionStart", type: "command", command: "date" },
  ];

  it("keys identity on (event, matcher, command)", () => {
    expect(hookIdentity(existing[0]!)).toBe('["PreToolUse","git","echo a"]');
    // same event+matcher but different command → distinct identity (no dedup)
    const other: HookEntry = {
      event: "PreToolUse",
      matcher: "git",
      type: "command",
      command: "echo b",
    };
    expect(hookIdentity(other)).not.toBe(hookIdentity(existing[0]!));
  });

  it("dedups identical entries and force-overwrites a changed message", () => {
    const discovered: HookEntry[] = [
      { event: "PreToolUse", matcher: "git", type: "command", command: "echo a", message: "NEW" }, // conflict
      { event: "Stop", type: "command", command: "cleanup" }, // new
    ];
    const missing = mergeHooks(existing, discovered, "missing");
    expect(missing.added).toBe(1); // only Stop
    expect(missing.conflicts).toBe(1);

    const force = mergeHooks(existing, discovered, "force");
    expect(force.overwritten).toBe(1);
    expect(force.items.find((h) => h.command === "echo a")?.message).toBe("NEW");
  });

  it("removes a hook by identity", () => {
    const id = hookIdentity(existing[0]!);
    expect(removeHookById(existing, id).map((h) => h.command)).toEqual(["date"]);
  });
});
