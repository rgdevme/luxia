import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  isAgentInstalled,
  isDomainInitialized,
  markAgentInstalled,
  markDomainInitialized,
  readState,
  unmarkAgentInstalled,
  writeState,
} from "../../src/core/state.js";

describe("state", () => {
  let dir: string;
  let statePath: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-state-"));
    statePath = path.join(dir, "state.json");
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("readState returns defaults when file is missing", async () => {
    const s = await readState(statePath);
    expect(s.version).toBe(1);
    expect(s.installedAgents).toEqual([]);
    expect(s.initializedDomains).toEqual([]);
  });

  it("round-trips through write + read", async () => {
    let s = await readState(statePath);
    s = markAgentInstalled(s, "claude-code");
    s = markDomainInitialized(s, "skills");
    await writeState(statePath, s);
    const reloaded = await readState(statePath);
    expect(reloaded).toEqual(s);
  });

  it("mark helpers are idempotent", async () => {
    let s = await readState(statePath);
    s = markAgentInstalled(s, "claude-code");
    s = markAgentInstalled(s, "claude-code");
    expect(s.installedAgents).toEqual(["claude-code"]);
    s = markDomainInitialized(s, "skills");
    s = markDomainInitialized(s, "skills");
    expect(s.initializedDomains).toEqual(["skills"]);
  });

  it("unmarkAgentInstalled removes the id", async () => {
    let s = await readState(statePath);
    s = markAgentInstalled(s, "claude-code");
    s = markAgentInstalled(s, "codex");
    s = unmarkAgentInstalled(s, "claude-code");
    expect(s.installedAgents).toEqual(["codex"]);
    expect(isAgentInstalled(s, "claude-code")).toBe(false);
    expect(isAgentInstalled(s, "codex")).toBe(true);
  });

  it("isDomainInitialized returns true after marking", async () => {
    let s = await readState(statePath);
    expect(isDomainInitialized(s, "skills")).toBe(false);
    s = markDomainInitialized(s, "skills");
    expect(isDomainInitialized(s, "skills")).toBe(true);
  });

  it("recovers from a malformed state.json (treats unknown shape as empty)", async () => {
    await fs.writeFile(statePath, JSON.stringify({ totally: "wrong" }));
    const s = await readState(statePath);
    expect(s.installedAgents).toEqual([]);
    expect(s.initializedDomains).toEqual([]);
  });
});
