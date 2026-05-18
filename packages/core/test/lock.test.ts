import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  emptyLock,
  getSkill,
  readLock,
  removeSkill,
  upsertSkill,
  writeLock,
} from "../src/lock.js";

async function tmpRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "agnos-lock-"));
}

describe("lock (per-skill)", () => {
  it("returns an empty lock when no file exists", async () => {
    const root = await tmpRoot();
    const lock = await readLock(root);
    expect(lock).toEqual({ version: 1, skills: {} });
  });

  it("round-trips a lock through write+read", async () => {
    const root = await tmpRoot();
    const lock = upsertSkill(emptyLock(), "github:foo/bar/skills/pdf", {
      computedHash: "a".repeat(64),
      resolvedAt: "2026-05-18T12:00:00.000Z",
    });
    await writeLock(root, lock);
    const back = await readLock(root);
    expect(back).toEqual(lock);
  });

  it("upsertSkill replaces an existing entry", () => {
    const a = upsertSkill(emptyLock(), "github:foo/bar/skills/pdf", {
      computedHash: "a".repeat(64),
      resolvedAt: "t1",
    });
    const b = upsertSkill(a, "github:foo/bar/skills/pdf", {
      computedHash: "b".repeat(64),
      resolvedAt: "t2",
    });
    expect(getSkill(b, "github:foo/bar/skills/pdf")).toMatchObject({
      computedHash: "b".repeat(64),
      resolvedAt: "t2",
    });
  });

  it("removeSkill drops the entry; no-op on missing key", () => {
    const a = upsertSkill(emptyLock(), "github:x/y/skills/z", {
      computedHash: "0".repeat(64),
      resolvedAt: "t",
    });
    const b = removeSkill(a, "github:x/y/skills/z");
    expect(getSkill(b, "github:x/y/skills/z")).toBeUndefined();
    const c = removeSkill(b, "github:not/there/skills/anywhere");
    expect(c.skills).toEqual({});
  });

  it("writeLock sorts skills by key for diff-friendly output", async () => {
    const root = await tmpRoot();
    let lock = emptyLock();
    lock = upsertSkill(lock, "z-key", { computedHash: "a".repeat(64), resolvedAt: "t" });
    lock = upsertSkill(lock, "a-key", { computedHash: "b".repeat(64), resolvedAt: "t" });
    await writeLock(root, lock);
    const raw = await fs.readFile(path.join(root, "agnos.lock.json"), "utf8");
    expect(raw.indexOf('"a-key"')).toBeLessThan(raw.indexOf('"z-key"'));
  });

  it("rejects invalid JSON", async () => {
    const root = await tmpRoot();
    await fs.writeFile(path.join(root, "agnos.lock.json"), "not json");
    await expect(readLock(root)).rejects.toThrow(/not valid JSON/);
  });

  it("rejects wrong schema (legacy schemaVersion key)", async () => {
    const root = await tmpRoot();
    await fs.writeFile(
      path.join(root, "agnos.lock.json"),
      JSON.stringify({ schemaVersion: 1, repos: {} }),
    );
    await expect(readLock(root)).rejects.toThrow(/schema validation failed/);
  });
});
