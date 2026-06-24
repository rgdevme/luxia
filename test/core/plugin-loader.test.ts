import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { loadPlugins } from "../src/plugin-loader.js";
import { createLogger } from "../src/logger.js";

interface FakePluginOpts {
  pkgDir: string;
  packageName: string;
  type: "agent" | "domain";
  id: string;
  exportName?: string;
}

async function writeFakePlugin(opts: FakePluginOpts): Promise<void> {
  await fs.mkdir(opts.pkgDir, { recursive: true });
  await fs.writeFile(
    path.join(opts.pkgDir, "package.json"),
    JSON.stringify(
      {
        name: opts.packageName,
        version: "0.0.1",
        type: "module",
        main: "./index.js",
        agnos: { type: opts.type, id: opts.id },
      },
      null,
      2,
    ),
  );
  // A minimal plugin module. The loader takes mod.default ?? mod[id] ?? mod.
  const exportName = opts.exportName ?? "default";
  const body =
    opts.type === "agent"
      ? `export ${exportName === "default" ? "default" : `const ${exportName} =`} { id: ${JSON.stringify(opts.id)}, displayName: ${JSON.stringify(opts.id)} };`
      : `export ${exportName === "default" ? "default" : `const ${exportName} =`} { name: ${JSON.stringify(opts.id)}, priority: 100, declarationSchema: { parse: (x) => x } };`;
  await fs.writeFile(path.join(opts.pkgDir, "index.js"), body);
}

async function writeRoot(rootDir: string, pluginNames: string[]): Promise<void> {
  await fs.mkdir(rootDir, { recursive: true });
  const deps: Record<string, string> = {};
  for (const name of pluginNames) deps[name] = "*";
  await fs.writeFile(
    path.join(rootDir, "package.json"),
    JSON.stringify({ name: path.basename(rootDir), version: "0.0.0", dependencies: deps }, null, 2),
  );
}

async function linkPlugin(rootDir: string, packageName: string, pluginDir: string): Promise<void> {
  const target = path.join(rootDir, "node_modules", packageName);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.cp(pluginDir, target, { recursive: true });
}

describe("plugin-loader bundle vs project", () => {
  let tmp: string;
  const logger = createLogger({ quiet: true });

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-loader-"));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("returns empty registry when neither root has plugins", async () => {
    const projectRoot = path.join(tmp, "project");
    await writeRoot(projectRoot, []);
    const reg = await loadPlugins({ projectRoot, logger });
    expect(reg.agents.size).toBe(0);
    expect(reg.domains.size).toBe(0);
  });

  it("loads project plugins (source=project)", async () => {
    const projectRoot = path.join(tmp, "project");
    const pluginDir = path.join(tmp, "plugins", "agent-foo");
    await writeFakePlugin({
      pkgDir: pluginDir,
      packageName: "agent-foo",
      type: "agent",
      id: "foo",
    });
    await writeRoot(projectRoot, ["agent-foo"]);
    await linkPlugin(projectRoot, "agent-foo", pluginDir);

    const reg = await loadPlugins({ projectRoot, logger });
    expect(reg.agents.get("foo")?.source).toBe("project");
    expect(reg.agents.get("foo")?.packageName).toBe("agent-foo");
  });

  it("falls back to bundle plugins when project lacks them", async () => {
    const projectRoot = path.join(tmp, "project");
    await writeRoot(projectRoot, []);
    const bundleRoot = path.join(tmp, "bundle");
    const pluginDir = path.join(tmp, "plugins", "agent-bar");
    await writeFakePlugin({
      pkgDir: pluginDir,
      packageName: "agent-bar",
      type: "agent",
      id: "bar",
    });
    await writeRoot(bundleRoot, ["agent-bar"]);
    await linkPlugin(bundleRoot, "agent-bar", pluginDir);

    const reg = await loadPlugins({ projectRoot, logger, bundleRoot });
    expect(reg.agents.get("bar")?.source).toBe("bundle");
  });

  it("project plugins override bundle plugins on id collision (no collision raised)", async () => {
    const projectRoot = path.join(tmp, "project");
    const bundleRoot = path.join(tmp, "bundle");

    const projectPluginDir = path.join(tmp, "plugins", "project-agent");
    const bundlePluginDir = path.join(tmp, "plugins", "bundle-agent");
    await writeFakePlugin({
      pkgDir: projectPluginDir,
      packageName: "@me/agent-x",
      type: "agent",
      id: "x",
    });
    await writeFakePlugin({
      pkgDir: bundlePluginDir,
      packageName: "@luxia/agent-x",
      type: "agent",
      id: "x",
    });

    await writeRoot(projectRoot, ["@me/agent-x"]);
    await linkPlugin(projectRoot, "@me/agent-x", projectPluginDir);
    await writeRoot(bundleRoot, ["@luxia/agent-x"]);
    await linkPlugin(bundleRoot, "@luxia/agent-x", bundlePluginDir);

    const reg = await loadPlugins({ projectRoot, logger, bundleRoot });
    const agent = reg.agents.get("x");
    expect(agent?.source).toBe("project");
    expect(agent?.packageName).toBe("@me/agent-x");
    expect(reg.collisions).toHaveLength(0);
  });

  it("merges project + bundle for disjoint plugin sets", async () => {
    const projectRoot = path.join(tmp, "project");
    const bundleRoot = path.join(tmp, "bundle");

    const aDir = path.join(tmp, "plugins", "a");
    const bDir = path.join(tmp, "plugins", "b");
    await writeFakePlugin({ pkgDir: aDir, packageName: "agent-a", type: "agent", id: "a" });
    await writeFakePlugin({ pkgDir: bDir, packageName: "domain-b", type: "domain", id: "b" });

    await writeRoot(projectRoot, ["agent-a"]);
    await linkPlugin(projectRoot, "agent-a", aDir);
    await writeRoot(bundleRoot, ["domain-b"]);
    await linkPlugin(bundleRoot, "domain-b", bDir);

    const reg = await loadPlugins({ projectRoot, logger, bundleRoot });
    expect(reg.agents.get("a")?.source).toBe("project");
    expect(reg.domains.get("b")?.source).toBe("bundle");
  });

  it("reads AGNOS_BUNDLE_ROOT from env when no explicit bundleRoot is given", async () => {
    const projectRoot = path.join(tmp, "project");
    await writeRoot(projectRoot, []);
    const bundleRoot = path.join(tmp, "bundle");
    const pluginDir = path.join(tmp, "plugins", "env-agent");
    await writeFakePlugin({
      pkgDir: pluginDir,
      packageName: "agent-env",
      type: "agent",
      id: "env",
    });
    await writeRoot(bundleRoot, ["agent-env"]);
    await linkPlugin(bundleRoot, "agent-env", pluginDir);

    const prev = process.env["AGNOS_BUNDLE_ROOT"];
    process.env["AGNOS_BUNDLE_ROOT"] = bundleRoot;
    try {
      const reg = await loadPlugins({ projectRoot, logger });
      expect(reg.agents.get("env")?.source).toBe("bundle");
    } finally {
      if (prev === undefined) delete process.env["AGNOS_BUNDLE_ROOT"];
      else process.env["AGNOS_BUNDLE_ROOT"] = prev;
    }
  });
});
