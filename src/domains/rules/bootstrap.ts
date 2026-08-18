import fs from "node:fs/promises";
import path from "node:path";
import type { CommandContext, CommandSpec, ParsedSource, Provider } from "../../core/index.js";
import { configExists, isProvider, parseSource, readConfig } from "../../core/index.js";
import { walkEntries } from "../../core/glob.js";
import { multiSelect } from "../cli-helpers.js";

const DEFAULT_RULES_SOURCE = "github:rgdevme/luxia/.rules";
const RULES_DISCOVERY_SUBDIR = ".rules";

export interface DiscoveredRule {
  absolutePath: string;
  relativePath: string;
}

export async function findRulesInDirectory(directory: string): Promise<DiscoveredRule[]> {
  const entries = await walkEntries(directory);
  return entries
    .filter((entry) => entry.kind === "file" && entry.relativePath.endsWith(".md"))
    .map((entry) => ({
      absolutePath: entry.absolutePath,
      relativePath: entry.relativePath,
    }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function resolveSource(
  address: string,
  provider: string | undefined,
  projectRoot: string,
): ParsedSource {
  if (provider === "file") return parseSource(`file:${address}`, { projectRoot });
  if (provider && !isProvider(provider)) {
    throw new Error(`unsupported provider "${provider}"`);
  }
  return parseSource(address, {
    projectRoot,
    ...(provider ? { defaultProvider: provider as Provider } : {}),
  });
}

function resolveCatalogDirectory(source: ParsedSource, fetchedRoot: string): string {
  if (source.kind === "local") return path.join(fetchedRoot, RULES_DISCOVERY_SUBDIR);
  return path.join(fetchedRoot, source.subPath ?? RULES_DISCOVERY_SUBDIR);
}

function resolveContainedPath(root: string, relativePath: string): string {
  const destination = path.resolve(root, relativePath);
  const relative = path.relative(root, destination);
  if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    throw new Error(`rule path escapes the configured rules directory: ${relativePath}`);
  }
  return destination;
}

async function copyRules(
  selected: readonly DiscoveredRule[],
  destinationRoot: string,
  ctx: CommandContext,
): Promise<void> {
  for (const rule of selected) {
    const destination = resolveContainedPath(destinationRoot, rule.relativePath);
    if (ctx.dryRun) {
      ctx.logger.info(`would: copy ${rule.relativePath} to ${destination}`);
      continue;
    }
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(rule.absolutePath, destination);
  }

  if (!ctx.dryRun) {
    ctx.logger.success(`copied ${selected.length} rule file${selected.length === 1 ? "" : "s"}`);
  }
}

export const bootstrapRulesCommand: CommandSpec = {
  name: "bootstrap",
  description: "Bootstrap rule fragments from a repository catalog",
  args: [
    {
      name: "source",
      required: false,
      description: "owner/repo[#ref], repository path, or local directory",
    },
  ],
  flags: [
    {
      name: "provider",
      type: "string",
      alias: "p",
      description: "provider for a source without a prefix (github|gitlab|bitbucket|file)",
    },
  ],
  async run(ctx) {
    if (!(await configExists(ctx.configPath))) {
      ctx.logger.warn("agnos has not been configured; run `agnos --init`");
      return;
    }

    const config = await readConfig(ctx.configPath);
    const rulesDir = config.rules?.dir;
    if (!rulesDir) {
      ctx.logger.warn("agnos has not been configured to manage rules; set rules.dir");
      return;
    }
    if (ctx.args.length > 1) throw new Error("rules bootstrap accepts at most one source");

    const address = ctx.args[0] ?? DEFAULT_RULES_SOURCE;
    const provider = typeof ctx.flags.provider === "string" ? ctx.flags.provider : undefined;
    const source = resolveSource(address, provider, ctx.projectRoot);
    const fetched = await ctx.logger.info({
      message: `Loading rules from ${address}...`,
      waitFor: ctx.fetcher.fetch(source, { discoverySubdir: RULES_DISCOVERY_SUBDIR }),
    });
    const catalogDirectory = resolveCatalogDirectory(source, fetched.path);
    const rules = await findRulesInDirectory(catalogDirectory);
    if (rules.length === 0) {
      throw new Error(`No Markdown rule files found in ${address}`);
    }

    const selectedPaths = ctx.flags.yes
      ? rules.map((rule) => rule.relativePath)
      : await multiSelect(
          ctx,
          "Select rules to bootstrap:",
          rules.map((rule) => ({ name: rule.relativePath, value: rule.relativePath })),
          "pass -y to bootstrap all rules, or run in a terminal to pick interactively",
        );
    if (selectedPaths.length === 0) {
      ctx.logger.info("nothing selected");
      return;
    }

    const selected = new Set(selectedPaths);
    const destinationRoot = path.isAbsolute(rulesDir)
      ? path.resolve(rulesDir)
      : path.resolve(ctx.projectRoot, rulesDir);
    await copyRules(
      rules.filter((rule) => selected.has(rule.relativePath)),
      destinationRoot,
      ctx,
    );
  },
};
