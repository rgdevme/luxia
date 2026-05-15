import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import type { CliCommand, ResolveContext } from "@agnos/core";
import { CONFIG_FILE, readConfigOrDefault } from "@agnos/core";
import { readEffectiveDocsConfig, initFiles, type EffectiveDocsConfig } from "../effective-config.js";
import { runValidate } from "./validate.js";
import { runGenerate } from "./generate.js";
import { runInject } from "./inject.js";
import { formatErrorBlock } from "./validate.js";

const DEBOUNCE_MS = 180;

export const watchCmd: CliCommand = {
  description:
    "Watch agnos.json, the docs directory, and the inject sources; auto-regenerate and reinject (use --once to run once and exit)",
  async run(args, ctx) {
    const once = args.flags["once"] === true;
    if (once) {
      await runOnce(ctx, { exitOnValidateFailure: true });
      return;
    }
    await runWatch(ctx);
  },
};

async function runOnce(
  ctx: ResolveContext,
  opts: { exitOnValidateFailure: boolean },
): Promise<void> {
  const cfg = await readEffectiveDocsConfig(ctx);
  const v = await runValidate(cfg, ctx);
  let validateFailed = false;
  if (v.issues.length > 0) {
    process.stderr.write(formatErrorBlock(cfg, v.issues, ctx) + "\n");
    validateFailed = true;
  }
  await runGenerate(cfg, ctx);
  await runInject(cfg, ctx);
  if (validateFailed && opts.exitOnValidateFailure) {
    process.exitCode = 1;
  }
}

async function runWatch(ctx: ResolveContext): Promise<void> {
  ctx.logger.info("docs: starting watchers (Ctrl+C to stop)");
  const state: WatchState = {
    ctx,
    cfg: await readEffectiveDocsConfig(ctx),
    docsWatcher: null,
    mainWatcher: null,
    docsQueue: createSerializedQueue(),
    mainQueue: createSerializedQueue(),
  };

  await initialPass(state);
  await openDownstreamWatchers(state);

  const configWatcher = chokidar.watch(path.join(ctx.projectRoot, CONFIG_FILE), {
    ignoreInitial: true,
  });
  const configQueue = createSerializedQueue();
  configWatcher.on("all", () => configQueue(() => onConfigChange(state)));

  const shutdown = async () => {
    ctx.logger.info("docs: stopping watchers");
    await Promise.all([
      configWatcher.close(),
      state.docsWatcher?.close(),
      state.mainWatcher?.close(),
    ]);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // keep alive forever
  await new Promise<void>(() => {});
}

interface WatchState {
  ctx: ResolveContext;
  cfg: EffectiveDocsConfig;
  docsWatcher: FSWatcher | null;
  mainWatcher: FSWatcher | null;
  docsQueue: SerializedQueue;
  mainQueue: SerializedQueue;
}

async function initialPass(state: WatchState): Promise<void> {
  const { ctx, cfg } = state;
  const v = await runValidate(cfg, ctx);
  if (v.issues.length > 0) {
    process.stderr.write(formatErrorBlock(cfg, v.issues, ctx) + "\n");
  }
  await runGenerate(cfg, ctx);
  await runInject(cfg, ctx);
}

async function openDownstreamWatchers(state: WatchState): Promise<void> {
  const { ctx, cfg } = state;
  const ignored = initFiles(cfg);

  state.docsWatcher = chokidar.watch(cfg.route, {
    ignored,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
  });
  state.docsWatcher.on("all", () => state.docsQueue(() => onDocsChange(state)));

  const mainPaths = [cfg.indexFile, cfg.docRulesFile];
  state.mainWatcher = chokidar.watch(mainPaths, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
  });
  state.mainWatcher.on("all", () => state.mainQueue(() => onMainChange(state)));

  ctx.logger.info(`  docs observer:  ${path.relative(ctx.projectRoot, cfg.route)} (excl. init files)`);
  ctx.logger.info(`  main observer:  ${path.relative(ctx.projectRoot, cfg.indexFile)} + ${path.relative(ctx.projectRoot, cfg.docRulesFile)}`);
  ctx.logger.info(`  config observer: ${CONFIG_FILE}`);
}

async function onDocsChange(state: WatchState): Promise<void> {
  const { ctx, cfg } = state;
  await debounce(DEBOUNCE_MS);
  ctx.logger.info("docs: change detected → validate + generate");
  const v = await runValidate(cfg, ctx);
  if (v.issues.length > 0) {
    process.stderr.write(formatErrorBlock(cfg, v.issues, ctx) + "\n");
  }
  await runGenerate(cfg, ctx);
}

async function onMainChange(state: WatchState): Promise<void> {
  const { ctx, cfg } = state;
  await debounce(DEBOUNCE_MS);
  ctx.logger.info("docs: init-file change detected → inject");
  await runInject(cfg, ctx);
}

async function onConfigChange(state: WatchState): Promise<void> {
  await debounce(DEBOUNCE_MS);
  const { ctx } = state;
  const fresh = await readConfigOrDefault(ctx.configPath);
  const newDocsBlock = JSON.stringify(((fresh as { docs?: unknown }).docs ?? null));
  // Compare against current cfg's source snapshot by re-reading.
  const previous = JSON.stringify(snapshotDocsConfig(state.cfg));
  if (newDocsBlock === previous) {
    ctx.logger.debug("docs: agnos.json changed but docs config is unchanged — no-op");
    return;
  }
  ctx.logger.info("docs: agnos.json#docs changed → restarting downstream watchers");
  await Promise.all([state.docsWatcher?.close(), state.mainWatcher?.close()]);
  state.docsWatcher = null;
  state.mainWatcher = null;
  state.cfg = await readEffectiveDocsConfig(ctx);
  await initialPass(state);
  await openDownstreamWatchers(state);
}

function snapshotDocsConfig(cfg: EffectiveDocsConfig): unknown {
  return {
    route: cfg.routeRelative,
    indexName: cfg.indexName,
    contentName: cfg.contentName,
    docRulesName: cfg.docRulesName,
    injectIndex: cfg.injectIndex,
    injectRules: cfg.injectRules,
    metadata: cfg.metadata,
  };
}

type SerializedQueue = (task: () => Promise<void>) => void;

function createSerializedQueue(): SerializedQueue {
  let running = false;
  let pending: (() => Promise<void>) | null = null;
  return (task) => {
    if (running) {
      pending = task; // collapse bursts to a single pending run
      return;
    }
    running = true;
    void (async () => {
      try {
        await task();
        while (pending) {
          const next = pending;
          pending = null;
          await next();
        }
      } catch (err) {
        // Don't crash the watch loop; surface via console.
        console.error((err as Error).message);
      } finally {
        running = false;
      }
    })();
  };
}

function debounce(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
