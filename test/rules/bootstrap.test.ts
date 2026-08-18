import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CommandContext, Logger, ParsedSourceRef, RepoFetcher } from "../../src/core/index.js";
import { createRepoFetcher } from "../../src/core/index.js";
import { bootstrapRulesCommand } from "../../src/domains/rules/bootstrap.js";

const promptMocks = vi.hoisted(() => ({ checkbox: vi.fn() }));

vi.mock("@inquirer/prompts", () => ({
  checkbox: promptMocks.checkbox,
  confirm: vi.fn(),
  input: vi.fn(),
  select: vi.fn(),
}));

let projectRoot: string;
let logs: string[];
let stdinTtyDescriptor: PropertyDescriptor | undefined;

function recordingLogger(): Logger {
  const record = (level: string, input: unknown): void => {
    const message =
      typeof input === "string"
        ? input
        : ((input as { message?: string }).message ?? JSON.stringify(input));
    logs.push(`${level}: ${message}`);
  };
  const info = vi.fn((input: unknown) => {
    record("info", input);
    if (input && typeof input === "object" && "waitFor" in input) {
      return (input as { waitFor: Promise<unknown> }).waitFor;
    }
    return undefined;
  });
  return {
    info: info as never,
    warn: vi.fn((input: unknown) => record("warn", input)) as never,
    error: vi.fn((input: unknown) => record("error", input)) as never,
    debug: vi.fn((input: unknown) => record("debug", input)) as never,
    success: vi.fn((input: unknown) => record("success", input)) as never,
  };
}

function commandContext(
  args: string[],
  options: { dryRun?: boolean; fetcher?: RepoFetcher; yes?: boolean } = {},
): CommandContext {
  return {
    agnosRoot: path.join(projectRoot, ".agnos"),
    projectRoot,
    storeDir: path.join(projectRoot, "store"),
    configPath: path.join(projectRoot, "agnos.json"),
    statePath: path.join(projectRoot, ".agnos", "state.json"),
    logger: recordingLogger(),
    fetcher:
      options.fetcher ??
      createRepoFetcher({ stagingDir: path.join(projectRoot, ".agnos", "tmp", "repos") }),
    linker: {} as never,
    dryRun: options.dryRun ?? false,
    args,
    flags: {
      dry: options.dryRun ?? false,
      once: true,
      quiet: true,
      help: false,
      init: false,
      yes: options.yes ?? true,
    },
  };
}

async function writeConfig(rules: object): Promise<void> {
  await fs.writeFile(
    path.join(projectRoot, "agnos.json"),
    JSON.stringify({ schemaVersion: 1, rules }),
  );
}

async function seedRule(relativePath: string, content: string): Promise<void> {
  const destination = path.join(projectRoot, "catalog", ".rules", relativePath);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, content);
}

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agnos-rules-bootstrap-"));
  logs = [];
  promptMocks.checkbox.mockReset();
  stdinTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
});

afterEach(async () => {
  if (stdinTtyDescriptor) {
    Object.defineProperty(process.stdin, "isTTY", stdinTtyDescriptor);
  } else {
    Reflect.deleteProperty(process.stdin, "isTTY");
  }
  vi.restoreAllMocks();
  await fs.rm(projectRoot, { recursive: true, force: true });
});

describe("rules bootstrap", () => {
  it("warns and returns before fetching when agnos is not initialized", async () => {
    const fetch = vi.fn();
    const ctx = commandContext([], { fetcher: { fetch, cleanup: vi.fn() } as never });

    await bootstrapRulesCommand.run(ctx);

    expect(fetch).not.toHaveBeenCalled();
    expect(logs).toContain("warn: agnos has not been configured; run `agnos --init`");
  });

  it("warns and returns before fetching when rules.dir is absent", async () => {
    await writeConfig({ files: {} });
    const fetch = vi.fn();
    const ctx = commandContext([], { fetcher: { fetch, cleanup: vi.fn() } as never });

    await bootstrapRulesCommand.run(ctx);

    expect(fetch).not.toHaveBeenCalled();
    expect(logs).toContain("warn: agnos has not been configured to manage rules; set rules.dir");
  });

  it("recursively copies Markdown files, excludes other files, and overwrites", async () => {
    await writeConfig({ dir: ".docs/.rules", files: {} });
    await seedRule("coding.md", "new coding");
    await seedRule("nested/testing.md", "new testing");
    await seedRule("nested/notes.txt", "ignored");
    const existing = path.join(projectRoot, ".docs", ".rules", "coding.md");
    await fs.mkdir(path.dirname(existing), { recursive: true });
    await fs.writeFile(existing, "old coding");

    await bootstrapRulesCommand.run(commandContext(["./catalog"]));

    await expect(fs.readFile(existing, "utf8")).resolves.toBe("new coding");
    await expect(
      fs.readFile(path.join(projectRoot, ".docs", ".rules", "nested", "testing.md"), "utf8"),
    ).resolves.toBe("new testing");
    await expect(
      fs.access(path.join(projectRoot, ".docs", ".rules", "nested", "notes.txt")),
    ).rejects.toThrow();
  });

  it("uses the default catalog source and .rules discovery subtree", async () => {
    await writeConfig({ dir: ".docs/.rules", files: {} });
    const checkout = path.join(projectRoot, "checkout");
    await fs.mkdir(path.join(checkout, ".rules"), { recursive: true });
    await fs.writeFile(path.join(checkout, ".rules", "coding.md"), "coding");
    const fetch = vi.fn(async () => ({ path: checkout }));
    const fetcher: RepoFetcher = { fetch: fetch as never, cleanup: vi.fn() };

    await bootstrapRulesCommand.run(commandContext([], { fetcher }));

    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({
        canonical: "github:rgdevme/luxia/.rules",
        subPath: ".rules",
      }) as ParsedSourceRef,
      { discoverySubdir: ".rules" },
    );
  });

  it("uses .rules for repository sources and honors explicit Git paths", async () => {
    await writeConfig({ dir: ".docs/.rules", files: {} });
    const checkout = path.join(projectRoot, "checkout");
    await fs.mkdir(path.join(checkout, "custom", "rules"), { recursive: true });
    await fs.writeFile(path.join(checkout, "custom", "rules", "custom.md"), "custom");
    const fetch = vi.fn(async () => ({ path: checkout }));
    const fetcher: RepoFetcher = { fetch: fetch as never, cleanup: vi.fn() };

    await bootstrapRulesCommand.run(commandContext(["owner/repo/custom/rules"], { fetcher }));

    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({ subPath: "custom/rules" }) as ParsedSourceRef,
      { discoverySubdir: ".rules" },
    );
    await expect(
      fs.readFile(path.join(projectRoot, ".docs", ".rules", "custom.md"), "utf8"),
    ).resolves.toBe("custom");
  });

  it("copies only interactive selections and treats an empty selection as a no-op", async () => {
    await writeConfig({ dir: ".docs/.rules", files: {} });
    await seedRule("a.md", "a");
    await seedRule("nested/b.md", "b");
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
    promptMocks.checkbox.mockResolvedValueOnce(["nested/b.md"]);

    await bootstrapRulesCommand.run(commandContext(["./catalog"], { yes: false }));

    await expect(fs.access(path.join(projectRoot, ".docs", ".rules", "a.md"))).rejects.toThrow();
    await expect(
      fs.readFile(path.join(projectRoot, ".docs", ".rules", "nested", "b.md"), "utf8"),
    ).resolves.toBe("b");

    promptMocks.checkbox.mockResolvedValueOnce([]);
    await bootstrapRulesCommand.run(commandContext(["./catalog"], { yes: false }));
    expect(logs).toContain("info: nothing selected");
  });

  it("reports dry-run copies without writing and rejects empty catalogs", async () => {
    await writeConfig({ dir: ".docs/.rules", files: {} });
    await seedRule("coding.md", "coding");

    await bootstrapRulesCommand.run(commandContext(["./catalog"], { dryRun: true }));

    await expect(
      fs.access(path.join(projectRoot, ".docs", ".rules", "coding.md")),
    ).rejects.toThrow();
    expect(logs.some((entry) => entry.includes("would: copy coding.md"))).toBe(true);

    await fs.rm(path.join(projectRoot, "catalog", ".rules"), { recursive: true, force: true });
    await expect(bootstrapRulesCommand.run(commandContext(["./catalog"]))).rejects.toThrow(
      "No Markdown rule files found",
    );
  });
});
