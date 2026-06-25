import { describe, it, expect } from "vitest";
import type { HookEntry } from "../../src/core/index.js";
import {
  flattenHooks,
  groupHooks,
  hookIdentity,
  type NativeHooks,
} from "../../src/agents/adapters/hooks-map.js";

const entries: HookEntry[] = [
  { event: "PreToolUse", matcher: "git", type: "command", command: "echo a", message: "guard" },
  { event: "PreToolUse", matcher: "git", type: "command", command: "echo b" },
  { event: "SessionStart", type: "command", command: "date" },
];

describe("groupHooks", () => {
  it("groups by (event, matcher) preserving first-seen order", () => {
    const { hooks } = groupHooks(entries, { withMessage: true });
    expect(Object.keys(hooks)).toEqual(["PreToolUse", "SessionStart"]);
    expect(hooks["PreToolUse"]).toHaveLength(1);
    expect(hooks["PreToolUse"]?.[0]?.matcher).toBe("git");
    expect(hooks["PreToolUse"]?.[0]?.hooks).toHaveLength(2);
    // matcher-less group omits the key entirely
    expect(hooks["SessionStart"]?.[0]?.matcher).toBeUndefined();
  });

  it("maps message → statusMessage only when withMessage is set", () => {
    expect(
      groupHooks(entries, { withMessage: true }).hooks["PreToolUse"]?.[0]?.hooks[0],
    ).toHaveProperty("statusMessage", "guard");
    expect(
      groupHooks(entries, { withMessage: false }).hooks["PreToolUse"]?.[0]?.hooks[0],
    ).not.toHaveProperty("statusMessage");
  });

  it("drops events outside the agent's supported set and counts them", () => {
    const { hooks, dropped } = groupHooks(entries, { events: new Set(["PreToolUse"]) });
    expect(Object.keys(hooks)).toEqual(["PreToolUse"]);
    expect(dropped).toBe(1);
  });

  it("is deterministic (identical input → identical output)", () => {
    expect(JSON.stringify(groupHooks(entries, { withMessage: true }))).toBe(
      JSON.stringify(groupHooks(entries, { withMessage: true })),
    );
  });
});

describe("flattenHooks", () => {
  it("round-trips a grouped record back to flat entries", () => {
    const { hooks } = groupHooks(entries, { withMessage: true });
    expect(flattenHooks(hooks)).toEqual(entries);
  });

  it("skips unknown events and non-command handlers", () => {
    const native: NativeHooks = {
      Nope: [{ hooks: [{ type: "command", command: "x" }] }],
      Stop: [
        { hooks: [{ type: "command", command: "ok" }, { type: "http", command: "y" } as never] },
      ],
    };
    const flat = flattenHooks(native);
    expect(flat).toEqual([{ event: "Stop", type: "command", command: "ok" }]);
  });

  it("returns [] for non-object input", () => {
    expect(flattenHooks(undefined)).toEqual([]);
    expect(flattenHooks([])).toEqual([]);
    expect(flattenHooks("nope")).toEqual([]);
  });
});

describe("hookIdentity", () => {
  it("keys on (event, matcher, command)", () => {
    expect(hookIdentity(entries[0]!)).toBe('["PreToolUse","git","echo a"]');
    expect(hookIdentity(entries[2]!)).toBe('["SessionStart",null,"date"]');
  });
});
