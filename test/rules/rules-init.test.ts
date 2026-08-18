import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Logger, ResolveContext } from "../../src/core/index.js";
import { readConfig, runDomainInitSteps } from "../../src/core/index.js";
import rulesDomain from "../../src/domains/rules/index.js";

let projectRoot: string;

function context(): ResolveContext {
  const logger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    success: () => undefined,
  } as Logger;
  return {
    agnosRoot: path.join(projectRoot, ".agnos"),
    projectRoot,
    storeDir: path.join(projectRoot, "store"),
    configPath: path.join(projectRoot, "agnos.json"),
    statePath: path.join(projectRoot, ".agnos", "state.json"),
    logger,
    fetcher: {} as never,
    linker: {} as never,
    dryRun: false,
  };
}

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-rules-init-"));
  await fs.writeFile(path.join(projectRoot, "agnos.json"), JSON.stringify({ schemaVersion: 1 }));
});

afterEach(async () => {
  await fs.rm(projectRoot, { recursive: true, force: true });
});

describe("rules initialization", () => {
  it("configures the default directory and wires its glob without bootstrapping", async () => {
    await runDomainInitSteps(rulesDomain, context(), { yes: true, dryRun: false });

    const config = await readConfig(path.join(projectRoot, "agnos.json"));
    expect(config.rules).toEqual({
      dir: ".docs/.rules",
      files: { "./AGENTS.md": ["."] },
    });
    await expect(fs.access(path.join(projectRoot, "AGENTS.md"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(projectRoot, ".docs", ".rules"))).rejects.toThrow();
  });

  it("preserves an existing directory and avoids duplicate glob declarations", async () => {
    await fs.writeFile(
      path.join(projectRoot, "agnos.json"),
      JSON.stringify({
        schemaVersion: 1,
        rules: { dir: "custom/rules", files: { "RULES.md": ["."] } },
      }),
    );

    await runDomainInitSteps(rulesDomain, context(), { yes: true, dryRun: false });

    const config = await readConfig(path.join(projectRoot, "agnos.json"));
    expect(config.rules).toEqual({
      dir: "custom/rules",
      files: { "RULES.md": ["."] },
    });
  });

  it("rebases old declarations when rules.dir is initialized", async () => {
    await fs.writeFile(
      path.join(projectRoot, "agnos.json"),
      JSON.stringify({
        schemaVersion: 1,
        docs: { root: ".docs" },
        rules: {
          files: { "./AGENTS.md": [".docs/.rules", ".docs/index.md"] },
        },
      }),
    );

    await runDomainInitSteps(rulesDomain, context(), { yes: true, dryRun: false });

    const config = await readConfig(path.join(projectRoot, "agnos.json"));
    expect(config.rules).toEqual({
      dir: ".docs/.rules",
      files: { "./AGENTS.md": [".", "../index.md"] },
    });
  });

  it("adds the configured docs index relative to rules.dir", async () => {
    await fs.writeFile(
      path.join(projectRoot, "agnos.json"),
      JSON.stringify({ schemaVersion: 1, docs: { root: ".docs" } }),
    );

    await runDomainInitSteps(rulesDomain, context(), { yes: true, dryRun: false });

    const config = await readConfig(path.join(projectRoot, "agnos.json"));
    expect(config.rules).toEqual({
      dir: ".docs/.rules",
      files: { "./AGENTS.md": [".", "../index.md"] },
    });
  });
});
