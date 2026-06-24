# PRD — `@luxia/agnos` v0.1 (single-package consolidation + domain redesign)

> Status: draft · Target version: 0.1.0 · Branch: `refactor/single-package`

## 0. Context & motivation

`agnos` is a CLI that gives users one config file (`agnos.json`) for all their AI-coding agents and materializes per-agent files (rules, MCP, skills, hooks, docs). Today it is an 8-package pnpm monorepo (`@luxia/core` + meta `@luxia/agnos` + 2 agent plugins + 5 domain plugins), discovered dynamically via a `package.json#agnos` field, lockstep-versioned at 0.0.11.

The current structure is costly to maintain: 8 `package.json`/`tsconfig`/`tsup.config` files, lockstep version machinery (`next-version.mjs`, `check-versions.mjs`), 8 npm tarballs per release, and a plugin-discovery layer that exists mainly to wire together packages that always ship together.

This PRD collapses everything into **one package `@luxia/agnos`** and re-architects the domain model around a clean split:

- **Config-writer domains** (`docs`, `rules`, `skills`, `mcp`, `hooks`) manage their own configuration.
- **One config-reader domain** (`agents`) consumes `agnos.json` + canonical outputs and renders every per-agent file.

This intentionally reverses two earlier decisions (first-class user-developed plugins; the nested-rule-files canonical-tree model). The project is pre-1.0; the migration is **greenfield/breaking** — no back-compat for old `agnos.json` files.

### Locked decisions

| Area         | Decision                                                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Packaging    | Single package `@luxia/agnos`; **closed built-in set** — no node_modules plugin discovery, no `AGNOS_BUNDLE_ROOT`, no public plugin API                                        |
| Sync model   | **`agents` is the sole renderer** of per-agent files; per-agent logic moves into per-agent adapters under the agents domain                                                    |
| rules        | `rules.files` inject-by-title model **replaces** the `filename`/`root`/`dirs` canonical tree                                                                                   |
| Rule mirrors | Per-agent rule files (CLAUDE.md ↔ AGENTS.md) are produced by the **agents** domain, not rules                                                                                  |
| docs         | Compile a single index file into `docs.root`; surface it by listing it in `rules.files`. Drop `content.md`, `doc-rules.md`, and docs' own injector. `route`→`root`             |
| hooks        | Flat array `{ event, matcher, type, command, message }`, **strict 5 fields** (no passthrough); `message` = native status text; remove by identity; **closed event vocabulary** |
| Watch        | A supervisor watches `agnos.json` and **restarts all watchers** on change; content domains never watch the config                                                              |
| Migration    | **Greenfield/breaking**; bump schema version; require `agnos --init`                                                                                                           |
| CLI          | **Hard rename**: `--dry`, `--y` (keep `-y`); drop `--dry-run`/`--yes`; remove standalone `init`/`install` commands                                                             |
| Version      | **0.1.0**; `npm deprecate` `@luxia/core` + the 6 plugin packages → `@luxia/agnos`                                                                                              |

## 1. Summary & goals

Ship `@luxia/agnos` as a single npm package whose domains divide cleanly into **config writers** and a single **config reader**:

- **Writers** (`docs`, `rules`, `skills`, `mcp`, `hooks`) manage their own slice and produce _canonical_ artifacts (entries in `agnos.json`, or canonical files like the rules file / docs index).
- **Reader** (`agents`) consumes `agnos.json` + canonical files and renders **all** per-agent native files via per-agent adapters.

**Goals**

- One package, one `package.json`, one build, one release, one published artifact.
- Uniform CLI: `agnos [domain] [--dry] [--once] [--quiet] [--help] [--init [--y]]`, every domain supporting every flag.
- Watch mode for the whole workspace with a single supervisor that guarantees idempotency on config change.
- Clean writer/reader separation that scales by adding (a) a domain or (b) an agent adapter, independently.

**Non-goals (v0.1)**

- Third-party/user-developed plugins (explicitly dropped; was a v0.1 goal, now reversed).
- Backward compatibility with the current `agnos.json` schema.
- New agents beyond the existing Claude Code and Codex.

## 2. Architecture

### 2.1 Writer/reader split

```
        ┌─────────────── config WRITERS ───────────────┐        ┌── reader ──┐
 docs ──▶ .docs/index.md (canonical file)                        │            │
 rules ─▶ ./AGENTS.md   (canonical file, sections injected)──────▶│  agents    │──▶ per-agent files
 skills ▶ agnos.json#skills  +  .agnos/skills/ (canonical bytes)  │ (adapters) │   CLAUDE.md, .mcp.json,
 mcp ───▶ agnos.json#mcp                                          │            │   .claude/settings.json,
 hooks ─▶ agnos.json#hooks                                        │            │   .claude/skills, .codex/*
        └───────────────────────────────────────────────┘        └────────────┘
```

- **`agnos.json` is the bus.** `skills`/`mcp`/`hooks` only _write_ it (via their subcommands). `rules` only _reads_ it (to learn which files to watch) and never edits it. `docs` doesn't touch it at runtime beyond reading its own slice. `agents` reads it to render.
- **Per-agent rendering lives in agent adapters** (`claude-code`, `codex`) owned by the `agents` domain. The current `agent.handles.<domain>` mechanism is replaced by adapter methods.

### 2.2 Package layout (single package)

```
agnos/
  package.json            # the one @luxia/agnos (bin: dist/cli.js)
  tsconfig.json           # merged from tsconfig.base.json + per-pkg configs
  tsup.config.ts          # single multi-entry config
  vitest.config.ts
  schema.json             # JSON schema (SCHEMA_URL → @luxia/agnos)
  src/
    cli.ts                # bin entry + router (was packages/core/src/cli.ts)
    index.ts              # internal barrel (public API minimized; closed set)
    registry.ts           # NEW static registry of built-in domains + agents
    core/                 # config.ts, orchestrator.ts, state.ts, lock.ts, logger.ts,
                          #   paths.ts, source.ts, schema.ts, fs/, skill-prepare.ts, …
    domains/
      docs/  rules/  skills/  mcp/  hooks/  agents/
    agents/adapters/
      claude-code/  codex/   # render + scrape logic, per agent
    templates/              # rules + docs starter templates (bundled by tsup)
  test/
```

- **Static registry** replaces `plugin-loader.ts` node_modules scanning: `BUILTIN_DOMAINS` and `BUILTIN_AGENTS` arrays imported at startup. No dynamic `import()`, no `AGNOS_BUNDLE_ROOT`, no `package.json#agnos` manifests, no peer-dependency contract.
- **Template assets** (`packages/domain-rules/templates`, `packages/domain-docs/templates`) must be copied into `dist` by tsup and read at runtime via paths computed from the _emitted_ layout — this is the single highest-risk migration item (the current `new URL("../templates/…", import.meta.url)` offsets change).

## 3. `agnos.json` schema (new)

```jsonc
{
  "$schema": "https://unpkg.com/@luxia/agnos/schema.json",
  "schemaVersion": 1, // greenfield marker; pre-1 configs are rejected with a pointer to `agnos --init`
  "agents": ["claude-code", "codex"], // array of built-in agent ids
  "docs": {
    "root": ".docs", // was `route`; default ".docs"
    "metadata": { "owner": "..." }, // MERGED onto opinionated defaults (title/description/read_when/agent_cant)
  },
  "rules": {
    "files": {
      // canonical file → injectable fragment files
      "./AGENTS.md": ["./.docs/index.md", "./fragments/security.md"],
    },
  },
  "skills": {
    "route": ".agnos/skills", // canonical skills dir (optional; default)
    "sources": { "pdf": "github:org/repo/skills/pdf" },
  },
  "mcp": [{ "name": "fs", "command": "npx", "args": ["-y", "server"], "transport": "stdio" }],
  "hooks": [
    {
      "event": "PreToolUse",
      "matcher": "git",
      "type": "command",
      "command": "echo guard",
      "message": "running git guard",
    },
  ],
}
```

**Breaking shape changes** (all in `src/core/schema.ts` + `src/core/types`):

- `rules`: `{ filename, root, dirs[] }` → `{ files: Record<canonicalPath, injectablePath[]> }`.
- `docs`: drop `index`/`content`/`docRules`/`injectIndex`/`injectRules`; rename `route`→`root`; keep `metadata` (now merged, not replaced).
- `hooks`: `Record<event, MatcherGroup[]>` → `Array<{ event, matcher?, type, command, message? }>` (strict, no `.passthrough()`).
- `agents`/`skills`/`mcp` keep their shapes.

## 4. CLI surface

```
agnos [domain] [--dry] [--once] [--quiet] [--help] [--init [--y]]
```

- **No domain** → run all domain processes (watch by default).
- **`<domain>`** → run that one domain's process (watch by default).
- **`--once`** → run a single pass, no watchers, exit.
- **`--dry`** → resolve + log "would:" lines, **no writes** (no `agnos.json` mutation, no canonical files, no per-agent render, no skill fetch). Implies `--once`.
- **`--quiet`** → errors only.
- **`--help`** → usage for the command/subcommands/flags.
- **`--init [--y]`** → bootstrap all domains (or the named one). `--y` = accept defaults, no prompts. (Keeps `-y` as the short alias of `--y`.)

**Per-domain subcommands**

| Domain   | Subcommands                                                          |
| -------- | -------------------------------------------------------------------- |
| `docs`   | (run only; config edited manually)                                   |
| `rules`  | (run only; config edited manually)                                   |
| `skills` | `migrate [--missing\|--force\|--skip]`                               |
| `mcp`    | `add` · `remove` · `update` · `migrate [--missing\|--force\|--skip]` |
| `hooks`  | `add` · `remove [<id>]` · `migrate [--missing\|--force\|--skip]`     |
| `agents` | `add [<agent>]` · `remove <agent>`                                   |

**Removed**: standalone `agnos init` (→ `agnos --init`), `agnos install` (→ `agnos --once`), `--dry-run`, `--yes`. `--debug`, `--cwd`, `--copy-on-no-symlink` are retained.

## 5. Watch / supervisor model

- A top-level **supervisor watches `agnos.json`**. On any change it **tears down and restarts every active watcher**, guaranteeing idempotency and picking up new config. This makes "`agnos` running in one terminal, `agnos skill add X` in another" safe.
- Content domains **never watch `agnos.json`**:
  - **rules** reads the config once to learn its injectable paths, then watches only those files; re-injects titled sections into the canonical file on change.
  - **docs** watches only files under `docs.root`; recompiles the index on change.
  - **skills/mcp/hooks** are pure writers — they have no watch loop (their bare `--once`/watch run is a no-op that points the user at their subcommands; `skills` additionally re-prepares `.agnos/skills/`).
  - **agents** reads `agnos.json` + watches the **derived canonical outputs** (the rules file(s), the docs index) so a rules/docs re-injection cascades into a per-agent re-render.
- **Run pipeline order** (for `--once` and the initial paint of watch-all): `skills`-prepare → `docs`-compile → `rules`-inject → `agents`-render. Priorities encode this; `mcp`/`hooks` contribute no run-phase work (only `agents` reads their slices).

```
edit fragment ─▶ rules watcher ─▶ re-inject ./AGENTS.md ─▶ agents watcher ─▶ re-mirror CLAUDE.md
edit doc      ─▶ docs watcher  ─▶ recompile .docs/index.md ─▶ rules watcher (index is in rules.files) ─▶ … ─▶ agents
edit agnos.json (any tool) ─▶ supervisor ─▶ restart all watchers
```

## 6. Domain specifications

### 6.1 docs (writer)

- **Config**: `{ root (default ".docs"), metadata }`. `metadata` **merges onto** the opinionated defaults (`title`, `description`, `read_when`, `agent_cant`), it does not replace them.
- **Behavior**: watch `root`, read frontmatter (gray-matter), validate each doc carries all declared metadata keys, **compile one index file** into `root` (e.g. `.docs/index.md`) grouped by top-level dir. The index carries a `title` in its own frontmatter so it can be injected by `rules`.
- **`--init`**: prompt for `root` (default `.docs`); `--y` accepts default.
- **Dropped vs today**: `content.md`, `doc-rules.md`, and docs' own rules-file injector (`packages/domain-docs/src/cli/inject.ts`). Injection is now the rules domain's job.

### 6.2 rules (writer)

- **Config**: `{ files: { "<canonicalRulesFilePath>": ["<injectableFilePath>", …] } }`.
- **Behavior**: for each canonical file, inject/replace a **titled section** for every injectable file. Each injectable must carry a `title` in its frontmatter; the title is the section boundary.
- **Section markers** (proposed): paired HTML-comment sentinels keyed by a title slug, so arbitrary markdown inside the body is safe and orphan detection is trivial:
  ```
  <!-- agnos:section:<slug> -->
  # <Title>
  …injected body (frontmatter stripped)…
  <!-- /agnos:section:<slug> -->
  ```
  When an injectable is removed from `rules.files`, its orphaned section is pruned on the next run.
- **`--init`**: prompt for `canonicalRulesFilePath` (default `./AGENTS.md`), seed `rules.files = { "<path>": [] }`; `--y` accepts default.
- **Does NOT**: edit `agnos.json` at runtime; mirror per-agent files (that's `agents`).
- **Replaces**: the entire `materialize-rules.ts` canonical-tree machinery (`resolveRules`, `materializeRuleMirrors`, `pruneRuleMirrors`, `sweepRuleOrphans`) and `createRuleMirrorHandler`.

### 6.3 skills (writer)

- **Config**: `{ route? (default ".agnos/skills"), sources: Record<name, ref> }` (unchanged shape).
- **Behavior**: subcommands write `sources` into `agnos.json`; the domain fetches/verifies skills into the canonical `.agnos/skills/` (`prepareSkills`). The agents domain links the canonical dir per agent.
- **`--init`**: create an empty `skills` object, **scrape the repo for existing skills** (each agent adapter contributes a scan of its native location, e.g. `.claude/skills`), and if any are found prompt to migrate.
- **`migrate`**: `--missing` (add only names absent from config) · `--force` (overwrite conflicts) · `--skip` (abort on any conflict). With no flag, prompt interactively (add-missing default).
- The existing skills.sh `skills-lock.json` import is folded in: if a lock file is present, offer it as a migration source.

### 6.4 mcp (writer)

- **Config**: `McpDeclaration[]` (unchanged).
- **Subcommands**: `add`/`remove`/`update` (interactive, write `agnos.json`), `migrate` (scrape agents' native MCP files via adapters — the relocated `onImport` — with `--missing/--force/--skip`).
- **`--init`**: empty array + scrape + prompt to migrate.

### 6.5 hooks (writer)

- **Config**: **flat array** of `{ event, matcher?, type, command, message? }` — **strict, no passthrough**. `type` is `"command"` for v0.1; `command` is the shell command; `message` is the **native status text** an agent shows when the hook fires (Claude → `statusMessage`; agents without an equivalent ignore it).
- **Normalized event vocabulary** (closed; unknown events rejected). Proposed canonical set (finalize against the two agents' real event names): `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Notification`, `Stop`, `SubagentStop`, `PreCompact`, `SessionStart`, `SessionEnd`. Each agent adapter maps the subset it supports and skips the rest.
- **"If a hook matches"**: a hook's **identity is `(event, matcher, command)`**. On `migrate`/import, an entry with a matching identity is de-duplicated/replaced rather than appended.
- **Adding**: manual — `agnos hooks add` (interactive) appends a standardized entry; users may also hand-edit the array.
- **Removing**: `agnos hooks remove <id>` removes by identity; **if no id is given, present a multiselect of the configured hooks**.
- **`--init`**: empty array + scrape agents' native hook files + prompt to migrate.
- **Rendering**: the agent adapters regroup the flat array into each agent's native format (e.g. Claude's `(event → matcher group → handlers)` record in `.claude/settings.json`; Codex's `.codex/hooks.json`).

### 6.6 agents (reader — the sole renderer)

- **Config**: `agents: AgentRef[]` (array of built-in ids).
- **Behavior**: reads `agnos.json` (the `agents`, `mcp`, `hooks`, `skills` slices) plus the canonical outputs (rules file(s), docs index already injected by rules) and, for each active agent, invokes that agent's **adapter** to render every per-agent file:
  - rules → mirror the canonical file to the agent's filename/location (CLAUDE.md ↔ AGENTS.md);
  - mcp → the agent's MCP config (`.mcp.json` / `.codex/config.toml`);
  - hooks → the agent's hooks file (`.claude/settings.json` / `.codex/hooks.json`);
  - skills → link `.agnos/skills/` into the agent's skills dir (`.claude/skills`, `.agents/skills`).
- **`--init`**: prompt which agents to enable → write `agents`. `--y` enables a default set (or none, per current init behavior).
- **`add [<agent>]`**: enable a built-in agent (bare `add` opens the picker) and render its files. **No npm install.**
- **`remove <agent>`**: remove the agent's rendered files, then drop it from `agnos.json#agents`.
- **Watch**: watches the canonical derived outputs (rules file(s), docs index) and re-renders on change; restarted by the supervisor on `agnos.json` change.

## 7. Agent adapters

Each built-in agent (`claude-code`, `codex`) provides an adapter under `src/agents/adapters/<id>/` with:

- **paths** (rules filename/root, skills dir),
- **render(slice, ctx)** per domain (rules-mirror, mcp, hooks, skills-link),
- **scrape(ctx)** per domain (read native files → declarations) used by `--init`/`migrate`.

This replaces today's `AgentPlugin.handles.<domain>` + `AgentPaths`. The orchestration loop becomes **agent-outer, slice-inner** (the agents domain iterates active agents and calls adapter render per slice), inverting today's domain-outer/agent-inner loop in `orchestrator.ts`.

## 8. Build, release, versioning

- **tsup**: one config, entries `{ cli, index }`; shebang on `cli`; copy `templates/` + `schema.json` into `dist`. Delete `tsup.base.ts` and all per-package configs.
- **tsconfig**: collapse `tsconfig.base.json` + 8 per-package configs into one (`rootDir: src`, `outDir: dist`, NodeNext, strict). All internal imports keep `.js` specifiers.
- **Drop Turbo + pnpm workspace** (`turbo.json`, `.turbo/`, `pnpm-workspace.yaml`); scripts become plain `tsup`/`vitest run`/`eslint .`/`tsc --noEmit`.
- **vitest**: one config; merge the 5 test dirs into `test/`.
- **release.yml**: single `pnpm version <bump>` + one `pnpm publish --provenance`. Delete `next-version.mjs`, `check-versions.mjs`, the per-package pack/publish loop, and the `packages/agnos/bin` shim.
- **Version**: `@luxia/agnos` → **0.1.0**. `npm deprecate "@luxia/core@*"` and each of the 6 plugin packages with a message pointing to `@luxia/agnos`.
- **SCHEMA_URL** in `config.ts` moves from `@luxia/core/schema.json` to `@luxia/agnos/schema.json`.

## 9. Migration mechanics (monorepo → single package)

1. `git mv` each `packages/*/src/**` into the new `src/` tree (preserve history); commit in logical chunks (core, domains, agents, templates, config).
2. Rewrite the ~44 `@luxia/core` imports across ~29 files to relative paths (keep `.js` extensions).
3. Add `src/registry.ts`; refactor `loadPlugins` to seed from the static arrays; delete node_modules scanning, `AGNOS_BUNDLE_ROOT`, `PluginManifest`, collision machinery.
4. Collapse 9 `package.json` → 1; delete workspace/turbo/per-package build configs and `packages/agnos/`.
5. Apply the schema rewrites (§3) and domain rewrites (§6); relocate per-agent rendering into adapters (§7).
6. Verify template bundling against the **emitted** `dist` layout (highest risk).
7. Rewrite READMEs and `AGENTS.md` (they describe a multi-package plugin framework).

## 10. Breaking changes (greenfield — no back-compat)

- `agnos.json` `rules`/`docs`/`hooks` shapes change; old configs are rejected with a pointer to `agnos --init`.
- `--dry-run`/`--yes` and the `init`/`install` commands are removed.
- Third-party plugins (any `@x/agnos-*` package) are no longer discovered.
- `@luxia/core` + the 6 plugin packages are deprecated.

## 11. Open items to finalize during implementation

- Exact normalized hook-event vocabulary, validated against Claude Code's and Codex's real event names (§6.5 list is proposed).
- Final section-marker syntax for rules injection (§6.2 proposes HTML sentinels).
- Whether `agnos agents` alone should auto-run `skills`-prepare as a dependency, or require `agnos`/`agnos skills` first.
- `--init --y` default agent set (none vs. detected).
- Advisory project lock (`.agnos/*.lock`) to guard concurrent `agnos.json` writers (nice-to-have).

## 12. Verification plan

- **Unit/integration (vitest)**: schema parse/reject for each new shape; rules section inject/replace/prune by title; docs index compile + metadata merge; hooks identity dedup on migrate; agent-adapter render + scrape round-trips for claude-code and codex.
- **Build**: `tsup` produces a single `dist` with templates + `schema.json`; runtime template reads resolve from `dist`; `bin` runs.
- **End-to-end smoke** in a scratch project:
  1. `agnos --init --y` → valid `agnos.json` + materialized files for enabled agents.
  2. `agnos skills migrate --missing`, `agnos mcp add`, `agnos hooks add` → correct `agnos.json` writes.
  3. `agnos` (watch-all): edit a docs file → index recompiles → rules re-injects `./AGENTS.md` → `CLAUDE.md` re-mirrors; in a second terminal `agnos skill add X` → supervisor restarts watchers and the new skill links.
  4. `agnos --dry` writes nothing (diff the working tree).
  5. `agnos agents remove codex` → Codex files removed, `agents` array updated.
- **Cross-OS**: symlink probe + copy fallback on Windows-without-Developer-Mode (existing behavior must survive).
