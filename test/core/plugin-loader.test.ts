import { describe, it, expect } from "vitest";
import { loadPlugins, refToId, resolveAgentByRef } from "../../src/core/plugin-loader.js";
import { createLogger } from "../../src/core/logger.js";

const logger = createLogger({ quiet: true });
const load = () => loadPlugins({ projectRoot: process.cwd(), logger });

describe("plugin-loader (static built-in registry)", () => {
  it("loads the built-in agents keyed by id", async () => {
    const reg = await load();
    expect([...reg.agents.keys()].sort()).toEqual(["claude-code", "codex"]);
    expect(reg.agents.get("claude-code")?.plugin.displayName).toBe("Claude Code");
  });

  it("loads the built-in domains keyed by name", async () => {
    const reg = await load();
    expect([...reg.domains.keys()].sort()).toEqual(["docs", "hooks", "mcp", "rules", "skills"]);
  });

  it("indexes agents by their synthetic package name and reports no collisions", async () => {
    const reg = await load();
    const byPkg = reg.agentsByPackage.get("@luxia/agnos#claude-code");
    expect(byPkg?.plugin.id).toBe("claude-code");
    expect(byPkg?.source).toBe("project");
    expect(reg.collisions).toHaveLength(0);
  });

  it("resolves an agent by id or by package name", async () => {
    const reg = await load();
    expect(resolveAgentByRef(reg, "codex")?.plugin.id).toBe("codex");
    expect(resolveAgentByRef(reg, "@luxia/agnos#codex")?.plugin.id).toBe("codex");
    expect(resolveAgentByRef(reg, "nope")).toBeUndefined();
  });

  it("maps a ref to its canonical id, falling back to the ref itself", async () => {
    const reg = await load();
    expect(refToId(reg, "@luxia/agnos#claude-code")).toBe("claude-code");
    expect(refToId(reg, "claude-code")).toBe("claude-code");
    expect(refToId(reg, "unknown")).toBe("unknown");
  });
});
