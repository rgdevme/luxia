import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createLinker } from "@luxia/core";
import type {
  AgentPlugin,
  Linker,
  Logger,
  MaterializeContext,
} from "@luxia/core";
import skillsPlugin, { findAgentsUsingSkillsDir } from "../src/index.js";

function silentLogger(): Logger {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    success: () => {},
  };
}

function makeAgent(id: string, skillsDir?: string, withHandles = false): AgentPlugin {
  const plugin: AgentPlugin = { id, displayName: id };
  if (skillsDir) plugin.paths = { skillsDir };
  if (withHandles) plugin.handles = { skills: { async onInitialize() {} } };
  return plugin;
}

function ctx(projectRoot: string, linker: Linker, agentId = "test"): MaterializeContext {
  return {
    agentId,
    indent: "",
    projectRoot,
    configPath: path.join(projectRoot, "agnos.json"),
    statePath: path.join(projectRoot, ".agnos", "state.json"),
    agnosRoot: path.join(projectRoot, ".agnos"),
    cacheDir: path.join(projectRoot, ".agnos", "cache"),
    logger: silentLogger(),
    fetcher: { resolve: async () => ({ path: "" }) },
    linker,
  };
}

describe("findAgentsUsingSkillsDir", () => {
  it("matches agents whose paths.skillsDir resolves to the same absolute path", () => {
    const root = "/tmp/proj";
    const a = makeAgent("a", ".claude/skills");
    const b = makeAgent("b", ".claude/skills");
    const c = makeAgent("c", ".codex/skills");
    const d = makeAgent("d"); // no skills dir
    const target = path.resolve(root, ".claude/skills");
    const matches = findAgentsUsingSkillsDir(target, [a, b, c, d], root);
    expect(matches.map((m) => m.id).sort()).toEqual(["a", "b"]);
  });
});

describe("skills domain onAgentActivate / onAgentDeactivate", () => {
  let projectRoot: string;
  let linker: Linker;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-skills-"));
    linker = createLinker({
      cacheDir: path.join(projectRoot, ".agnos", "cache"),
      logger: silentLogger(),
      copyFallback: true,
    });
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it("links agent.paths.skillsDir to the canonical .agnos/skills/ on activate", async () => {
    const agent = makeAgent("claude-code", ".claude/skills");
    await skillsPlugin.onAgentActivate!(agent, [agent], ctx(projectRoot, linker, agent.id));

    const linkPath = path.join(projectRoot, ".claude", "skills");
    const stat = await fs.lstat(linkPath);
    expect(stat.isSymbolicLink() || stat.isDirectory()).toBe(true);

    // Files created in canonical should be visible via the link.
    const canonical = path.join(projectRoot, ".agnos", "skills");
    await fs.mkdir(path.join(canonical, "demo"), { recursive: true });
    await fs.writeFile(path.join(canonical, "demo", "SKILL.md"), "x", "utf8");
    const visible = await fs.readFile(path.join(linkPath, "demo", "SKILL.md"), "utf8");
    expect(visible).toBe("x");
  });

  it("is idempotent: second activate with the same path leaves the link in place", async () => {
    const a = makeAgent("claude-code", ".claude/skills");
    const b = makeAgent("twin", ".claude/skills");
    const mctx = ctx(projectRoot, linker);
    await skillsPlugin.onAgentActivate!(a, [a, b], mctx);
    await skillsPlugin.onAgentActivate!(b, [a, b], mctx);

    const linkPath = path.join(projectRoot, ".claude", "skills");
    const real = await fs.realpath(linkPath);
    expect(real).toBe(await fs.realpath(path.join(projectRoot, ".agnos", "skills")));
  });

  it("skips bootstrap when agent has its own handles.skills (escape hatch)", async () => {
    const agent = makeAgent("custom", ".claude/skills", /* withHandles */ true);
    await skillsPlugin.onAgentActivate!(agent, [agent], ctx(projectRoot, linker, agent.id));
    // No link created — agent owns its strategy.
    const stat = await fs.lstat(path.join(projectRoot, ".claude", "skills")).catch(() => null);
    expect(stat).toBe(null);
  });

  it("no-op when agent does not declare paths.skillsDir", async () => {
    const agent = makeAgent("codex");
    await skillsPlugin.onAgentActivate!(agent, [agent], ctx(projectRoot, linker, agent.id));
    const stat = await fs.lstat(path.join(projectRoot, ".claude", "skills")).catch(() => null);
    expect(stat).toBe(null);
  });

  it("deactivate unlinks when no remaining agent shares the path", async () => {
    const agent = makeAgent("claude-code", ".claude/skills");
    const mctx = ctx(projectRoot, linker, agent.id);
    await skillsPlugin.onAgentActivate!(agent, [agent], mctx);
    expect(
      await fs.lstat(path.join(projectRoot, ".claude", "skills")).catch(() => null),
    ).not.toBe(null);

    await skillsPlugin.onAgentDeactivate!(agent, [], mctx);
    expect(
      await fs.lstat(path.join(projectRoot, ".claude", "skills")).catch(() => null),
    ).toBe(null);
  });

  it("deactivate preserves the link when another active agent still uses it", async () => {
    const a = makeAgent("claude-code", ".claude/skills");
    const b = makeAgent("twin", ".claude/skills");
    const mctx = ctx(projectRoot, linker, a.id);
    await skillsPlugin.onAgentActivate!(a, [a, b], mctx);
    await skillsPlugin.onAgentDeactivate!(a, [b], mctx);

    const stat = await fs.lstat(path.join(projectRoot, ".claude", "skills")).catch(() => null);
    expect(stat).not.toBe(null);
  });

  it("migrates a legacy per-skill-junction directory to a dir-level symlink", async () => {
    const agent = makeAgent("claude-code", ".claude/skills");
    const canonical = path.join(projectRoot, ".agnos", "skills");
    const linkPath = path.join(projectRoot, ".claude", "skills");

    // Set up the legacy layout: real directory with per-skill junctions.
    await fs.mkdir(path.join(canonical, "alpha"), { recursive: true });
    await fs.mkdir(linkPath, { recursive: true });
    await linker.link(path.join(canonical, "alpha"), path.join(linkPath, "alpha"));

    await skillsPlugin.onAgentActivate!(agent, [agent], ctx(projectRoot, linker, agent.id));

    const real = await fs.realpath(linkPath);
    expect(real).toBe(await fs.realpath(canonical));
  });
});
