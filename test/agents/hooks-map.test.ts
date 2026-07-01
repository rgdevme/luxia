import { describe, it, expect } from "vitest";
import type { HookEntry, HookEventMap } from "../../src/core/index.js";
import {
  hookIdentity,
  renderNativeHooks,
  scrapeNativeHooks,
  supportsHookEvent,
  type NativeHooks,
} from "../../src/agents/adapters/hooks-map.js";

const entries: HookEntry[] = [
  { event: "PreToolUse", matcher: "git", type: "command", command: "echo a", message: "guard" },
  { event: "PreToolUse", matcher: "git", type: "command", command: "echo b" },
  { event: "SessionStart", type: "command", command: "date" },
];

/** Identity map covering the events used in these tests. */
const IDENTITY: HookEventMap = {
  PreToolUse: "PreToolUse",
  SessionStart: "SessionStart",
  Stop: "Stop",
};

/** A rename map (canonical → native), like Gemini's. */
const RENAME: HookEventMap = { PreToolUse: "BeforeTool", SessionStart: "SessionStart" };

describe("renderNativeHooks", () => {
  it("groups by (event, matcher) preserving first-seen order", () => {
    const { hooks } = renderNativeHooks(entries, IDENTITY, { withMessage: true });
    expect(Object.keys(hooks)).toEqual(["PreToolUse", "SessionStart"]);
    expect(hooks["PreToolUse"]).toHaveLength(1);
    expect(hooks["PreToolUse"]?.[0]?.matcher).toBe("git");
    expect(hooks["PreToolUse"]?.[0]?.hooks).toHaveLength(2);
    // matcher-less group omits the key entirely
    expect(hooks["SessionStart"]?.[0]?.matcher).toBeUndefined();
  });

  it("keys by the agent's native event name", () => {
    const { hooks } = renderNativeHooks(entries, RENAME, { withMessage: false });
    expect(Object.keys(hooks)).toEqual(["BeforeTool", "SessionStart"]);
  });

  it("maps message → statusMessage only when withMessage is set", () => {
    expect(
      renderNativeHooks(entries, IDENTITY, { withMessage: true }).hooks["PreToolUse"]?.[0]
        ?.hooks[0],
    ).toHaveProperty("statusMessage", "guard");
    expect(
      renderNativeHooks(entries, IDENTITY, { withMessage: false }).hooks["PreToolUse"]?.[0]
        ?.hooks[0],
    ).not.toHaveProperty("statusMessage");
  });

  it("skips events the agent doesn't map and counts them", () => {
    const { hooks, dropped } = renderNativeHooks(entries, { PreToolUse: "PreToolUse" });
    expect(Object.keys(hooks)).toEqual(["PreToolUse"]);
    expect(dropped).toBe(1);
  });

  it("is deterministic (identical input → identical output)", () => {
    expect(JSON.stringify(renderNativeHooks(entries, IDENTITY, { withMessage: true }))).toBe(
      JSON.stringify(renderNativeHooks(entries, IDENTITY, { withMessage: true })),
    );
  });
});

describe("scrapeNativeHooks", () => {
  it("round-trips a rendered record back to flat entries (identity map)", () => {
    const { hooks } = renderNativeHooks(entries, IDENTITY, { withMessage: true });
    expect(scrapeNativeHooks(hooks, IDENTITY)).toEqual(entries);
  });

  it("translates native event names back to canonical (rename map)", () => {
    const { hooks } = renderNativeHooks(entries, RENAME, { withMessage: false });
    expect(scrapeNativeHooks(hooks, RENAME)).toEqual([
      { event: "PreToolUse", matcher: "git", type: "command", command: "echo a" },
      { event: "PreToolUse", matcher: "git", type: "command", command: "echo b" },
      { event: "SessionStart", type: "command", command: "date" },
    ]);
  });

  it("skips unmapped events and non-command handlers", () => {
    const native: NativeHooks = {
      Nope: [{ hooks: [{ type: "command", command: "x" }] }],
      Stop: [
        { hooks: [{ type: "command", command: "ok" }, { type: "http", command: "y" } as never] },
      ],
    };
    expect(scrapeNativeHooks(native, IDENTITY)).toEqual([
      { event: "Stop", type: "command", command: "ok" },
    ]);
  });

  it("returns [] for non-object input", () => {
    expect(scrapeNativeHooks(undefined, IDENTITY)).toEqual([]);
    expect(scrapeNativeHooks([], IDENTITY)).toEqual([]);
    expect(scrapeNativeHooks("nope", IDENTITY)).toEqual([]);
  });
});

describe("supportsHookEvent", () => {
  it("reflects presence of the event in the map", () => {
    expect(supportsHookEvent(RENAME, "PreToolUse")).toBe(true);
    expect(supportsHookEvent(RENAME, "Stop")).toBe(false);
    expect(supportsHookEvent(undefined, "Stop")).toBe(false);
  });
});

describe("hookIdentity", () => {
  it("keys on (event, matcher, command)", () => {
    expect(hookIdentity(entries[0]!)).toBe('["PreToolUse","git","echo a"]');
    expect(hookIdentity(entries[2]!)).toBe('["SessionStart",null,"date"]');
  });
});
