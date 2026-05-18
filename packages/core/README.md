# @luxia/core

[![npm version](https://img.shields.io/npm/v/@luxia/core?color=18181B&label=npm&style=flat-square)](https://www.npmjs.com/package/@luxia/core)
[![node](https://img.shields.io/node/v/@luxia/core?color=18181B&style=flat-square)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/@luxia/core?color=18181B&style=flat-square)](https://github.com/rgdevme/luxia/blob/main/LICENSE)

The core of [agnos](https://github.com/rgdevme/luxia). Ships the CLI binary, the plugin loader, the orchestrator, and every public type that agent and domain plugins build against.

## What it provides

- **The `agnos` CLI binary.** Parses commands, builds a `ResolveContext`, loads plugins, and dispatches.
- **The plugin loader.** Walks the project's `node_modules` for any package with an `"agnos"` field in its `package.json` and registers it.
- **The orchestrator.** Coordinates per-domain resolve and per-agent materialize lifecycles, with idempotent re-runs and per-agent cleanup.
- **Cross-platform filesystem primitives.** A `Linker` that probes for symlink privileges and falls back to junctions or copies, plus a `RepoFetcher` for git and local skill sources.
- **The public type surface** that agent and domain plugins import: `AgentPlugin`, `DomainPlugin`, `ResolveContext`, `MaterializeContext`, and every resolved-item shape.

## Install

You usually install [`@luxia/agnos`](../agnos/README.md) instead. Install `@luxia/core` directly only when you are building a plugin and need the types and helpers:

```sh
pnpm add -D @luxia/core
```

In a plugin's `package.json`:

```json
{
  "peerDependencies": {
    "@luxia/core": "^0.0.5"
  }
}
```

## Public API

Everything is named-exported from the package root. The most common entry points:

```ts
import type {
  AgentPlugin,
  DomainPlugin,
  ResolveContext,
  MaterializeContext,
  ResolvedRule,
  ResolvedMcp,
  ResolvedSkill,
  Logger,
} from "@luxia/core";

import {
  // CLI and orchestration
  loadPlugins,
  reconcile,
  reinstate,
  activateAgent,
  materializeAgent,
  cleanupAgent,

  // Config and state
  readConfig,
  writeConfig,
  readState,
  writeState,

  // Paths
  buildPaths,
  findProjectRoot,
  AGNOS_DIR,
  CONFIG_FILE,
  STATE_FILE,

  // Sources and fetching
  parseSource,
  createRepoFetcher,
  resolveGitCommit,

  // Skills
  findSkillsInRepo,
  hashSkillDir,
  prepareSkills,

  // Filesystem
  createLinker,
  ensureLink,

  // Logging
  createLogger,
} from "@luxia/core";
```

## Plugin contracts

### Agent plugin

```ts
import type { AgentPlugin } from "@luxia/core";

const plugin: AgentPlugin = {
  id: "myagent",
  displayName: "My Agent",
  paths: { skillsDir: ".myagent/skills" },
  handles: {
    rules: {
      async onInitialize(state, ctx) {
        /* materialize */
      },
      async onCleanup(ctx) {
        /* strip */
      },
    },
    mcp: {
      async onInitialize(state, ctx) {
        /* regenerate */
      },
      async onCleanup(ctx) {
        /* strip */
      },
    },
  },
};

export default plugin;
```

The full interface lives in [src/types/public.ts](src/types/public.ts).

### Domain plugin

```ts
import type { DomainPlugin } from "@luxia/core";
import { z } from "zod";

const plugin: DomainPlugin = {
  name: "prompts",
  priority: 50,
  declarationSchema: z.object({
    /* ... */
  }),
  async resolve(decl, ctx) {
    /* ... */
  },
  async add(input, ctx) {
    /* ... */
  },
  async remove(name, ctx) {
    /* ... */
  },
};

export default plugin;
```

Built-in domain priorities: rules=10, mcp=20, skills=30, docs=40. Lower runs first on activation; higher runs first on cleanup.

## Discovery

agnos finds plugins by scanning `node_modules` for any package whose `package.json` contains:

```json
{
  "agnos": {
    "type": "agent",
    "id": "myagent"
  }
}
```

`type` is `"agent"` or `"domain"`. `id` is the short name users put in `agnos.json#agents` or that the orchestrator uses to route domain handlers. The package's default export is the plugin object. No registration call. No central allowlist.

When two installed plugins claim the same id, agnos errors at startup and asks the user to disambiguate via `{ id, package }` in `agnos.json#agents`.

## ResolveContext

Every plugin handler receives a `ResolveContext` (or `MaterializeContext`, which extends it). It contains everything a plugin should need without reaching into the filesystem on its own:

```ts
interface ResolveContext {
  agnosRoot: string; // absolute path of .agnos/
  projectRoot: string; // absolute path of the project
  cacheDir: string; // absolute path of .agnos/cache/
  configPath: string; // absolute path of agnos.json
  statePath: string; // absolute path of .agnos/state.json
  logger: Logger; // info / success / warn / error / debug
  fetcher: RepoFetcher; // git + local source fetching
  linker: Linker; // cross-platform symlink + fallback
  dryRun?: boolean; // when true, plugins log "would: ..." and skip side effects
  indent?: string; // prepended to wrapped logger output inside hooks
}
```

Plugins should never construct paths from `process.cwd()`. Always go through `ctx`.

## Lifecycle

The orchestrator iterates domains by ascending `priority` for activation and descending for cleanup. For each agent:

1. `domain.onInitialize(ctx)` runs once per project (gated by `.agnos/state.json`).
2. `domain.resolve(declaration, ctx)` produces `ResolvedRule`/`ResolvedMcp`/etc.
3. `domain.onAgentActivate(agent, activeAgents, ctx)` lets the domain bootstrap declarative agent paths (this is how `paths.skillsDir` becomes a symlink).
4. `agent.handles.<domain>.onInitialize(state, ctx)` materializes the resolved state for this agent.

On removal, step 4 becomes `onCleanup`, step 3 becomes `onAgentDeactivate`, and everything runs in reverse priority order.

Every step must be idempotent. Re-running `agnos install` on a clean tree should produce zero output.

## License

MIT.
