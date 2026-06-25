# Implementation Plan — `@luxia/agnos` v0.1

## Context

The spec is [`prd.md`](./prd.md) in this directory (this plan does not restate it — it sequences it). We are collapsing an 8-package pnpm monorepo into one package `@luxia/agnos` **and** re-architecting the domain model into config **writers** (`docs`, `rules`, `skills`, `mcp`, `hooks`) and a single config **reader** (`agents`, the sole renderer). The migration is greenfield/breaking (PRD §10).

**Sequencing principle: consolidate first, then redesign.** M1 collapses the packages while _preserving today's behavior_, giving a green baseline. M2 introduces the breaking schema + new contracts; from M2 the branch is intentionally **not** end-to-end green — each milestone keeps its own area unit-green, and full green (the PRD §12 e2e) returns at **M8** when the CLI/supervisor tie the writer/reader split together. M9 ships it.

Milestone dependency chain: **M1 → M2 → M3 → {M4, M5, M6, M7} → M8 → M9** (M4–M7 are largely parallel once M2/M3 land).

Key file references (current → target): `packages/core/src/*` → `src/core/*` (lifting `cli.ts`, `index.ts`, `types/`, `fs/`); `packages/domain-*/src/*` → `src/domains/<id>/*`; `packages/agent-*/src/*` → `src/agents/adapters/<id>/*`. The two big rewrites are `packages/core/src/cli.ts` (dispatch) and `packages/core/src/orchestrator.ts` (the domain-outer→agent-outer inversion).

---

## Branching protocol

This refactor is executed as **stacked branches — one per milestone** — so each milestone can be reviewed in isolation. The autonomous run MUST follow this exactly.

- **Base:** `refactor/single-package` holds only the spec + this plan. Never commit milestone work to it, and never touch `main`.
- **One branch per milestone**, each branched off the **previous** milestone's branch (M1 off the base):

  | Milestone | Branch                      | Branched from               |
  | --------- | --------------------------- | --------------------------- |
  | M1        | `refactor/m1-consolidation` | `refactor/single-package`   |
  | M2        | `refactor/m2-schema`        | `refactor/m1-consolidation` |
  | M3        | `refactor/m3-agents`        | `refactor/m2-schema`        |
  | M4        | `refactor/m4-rules`         | `refactor/m3-agents`        |
  | M5        | `refactor/m5-docs`          | `refactor/m4-rules`         |
  | M6        | `refactor/m6-skills`        | `refactor/m5-docs`          |
  | M7        | `refactor/m7-mcp-hooks`     | `refactor/m6-skills`        |
  | M8        | `refactor/m8-cli-watch`     | `refactor/m7-mcp-hooks`     |
  | M9        | `refactor/m9-release`       | `refactor/m8-cli-watch`     |

- **Resume rule (run at the start of every turn):** list branches matching `refactor/m*`; the highest-numbered one is the current milestone.
  - None exist → create `refactor/m1-consolidation` off `refactor/single-package` and start M1.
  - Current milestone's **gate passes** → create the next milestone's branch off it and start that milestone.
  - Otherwise → stay on the current branch and continue its unchecked checklist items.
- **Within a milestone:** commit in logical chunks (never one giant commit); tick this plan's checkboxes on the milestone branch as items complete, committing those edits too; run the milestone **gate** before advancing.
- **Never** rebase, squash, or merge across milestone branches (preserve reviewable per-milestone history), and **do not push** — branches stay local for review unless explicitly asked.
- **If a gate cannot be met** after a few honest attempts, STOP and report the blocker rather than working around it or skipping ahead.
- Review later: `git diff refactor/m{N-1}-…..refactor/mN-…` (or a PR of each branch onto its parent) shows exactly that milestone's work.

---

## M1 — Single-package consolidation (behavior-preserving)

**Goal:** one package, one build, today's behavior unchanged. Green at the end.

- [x] Scaffold `src/` tree: `core/`, `domains/{docs,rules,skills,mcp,hooks}/`, `agents/{claude-code,codex}/` (kept as plugins for now; adapters land M3), `fs/`, plus `cli.ts`, `index.ts`, `registry.ts`, `templates/`.
- [x] `git mv` package sources into the tree (preserve history); commit in chunks (core, domains, agents, templates, config).
- [x] Rewrite the ~44 `@luxia/core`/`@luxia/core/fs` imports across ~29 files to relative paths, keeping `.js` specifiers.
- [x] Replace `plugin-loader.ts` node_modules scan with a static `registry.ts` (`BUILTIN_DOMAINS`, `BUILTIN_AGENTS`); keep the `loadPlugins({projectRoot,logger})` signature; assign each built-in a synthetic stable `packageName` (used by `agentsByPackage`/`resolveAgentByRef`/`refToId`). Delete `AGNOS_BUNDLE_ROOT`, `PluginManifest`, the `bundle` PluginSource, and collision-by-package machinery.
- [x] One root `package.json` (`name: @luxia/agnos`, `bin: ./dist/cli.js`, merged runtime deps: `@inquirer/prompts`, `@iarna/toml`, `chokidar`, `giget`, `gray-matter`, `js-yaml`, `minimist`, `picomatch`, `zod`); drop peerDeps + `workspace:*`.
- [x] One `tsconfig.json` (rootDir `src`, outDir `dist`, NodeNext, strict); one `tsup.config.ts` (entries `cli`+`index`, shebang on `cli`, **copy `templates/` + `schema.json` into `dist`**); one `vitest.config.ts`.
- [x] Delete `pnpm-workspace.yaml`, `turbo.json`, `.turbo/`, `tsup.base.ts`, all per-package `package.json`/`tsconfig.json`/`tsup.config.ts`, and `packages/agnos/{bin,scripts}` (incl. `next-version.mjs`, `check-versions.mjs`).
- [x] Merge `packages/*/test` → `test/`; fix `plugin-loader.test.ts` bundle/collision cases (removed concepts); resolve same-named test collisions.
- [x] Rewrite `ci.yml` (drop turbo cache + workspace fan-out; single install→format→lint→typecheck→test→build; update `paths:` triggers off `packages/**`) and `release.yml` (single `pnpm version <bump>` + one `pnpm publish --provenance`; remove lockstep bump, next/check-versions, per-package pack/publish loop). **No publish in M1.**
- [x] Add a test that exercises `getStarterContent()` (rules) and the docs template reads from the **built `dist`**, verifying `new URL("../templates/…", import.meta.url)` offsets survive the emitted layout. _(Highest-risk item.)_

**Gate:** `pnpm build/typecheck/test/lint` green; `node dist/cli.js --help`, `init`, `install` behave exactly as pre-consolidation.

---

## M2 — Breaking schema + new contracts

**Goal:** land the new `agnos.json` shapes and the interfaces the redesign builds on. (Branch goes non-green on old behavior here; restored incrementally.)

- [x] Rewrite `src/core/schema.ts` + `src/core/types/public.ts`: `rules.files: Record<canonical, injectable[]>`; `docs: {root, metadata}`; `hooks: Array<{event, matcher?, type, command, message?}>` (strict, no passthrough) with a **closed event enum**; add top-level `schemaVersion`. Remove the rules tree schema, docs `index/content/docRules/inject*`, and the hooks record schema.
- [x] Config load rejects missing/old `schemaVersion` pointing to `agnos --init` (PRD §10). Move `SCHEMA_URL` → `@luxia/agnos/schema.json` and regenerate `schema.json`.
- [x] Add new contracts to `src/core/types`: `Domain` (`id/description/kind/priority/run?/initSteps?/commands?`), `FlagSpec`/`ArgSpec`/`CommandSpec`, `ParsedFlags`/`RunContext`/`CommandContext`, and `AgentAdapter` (`paths`/`render`/`scrape`/`claims`). Mark `DomainEventHandlers`/`AgentPaths`/`handles` for removal in M3.
- [x] Extend `.agnos/lock.json` entry with `resolvedCommit` + `ref` alongside `computedHash`/`resolvedAt` (PRD §6.3, §13.5).

**Gate:** schema parse/reject unit tests pass; `schema.ts`/types compile.

---

## M3 — Agents domain + adapters (the sole renderer) — the inversion

**Goal:** one renderer. Replace per-domain `handles.<domain>` with per-agent adapters driven by the `agents` domain.

- [x] Create `src/domains/agents/` (config-reader, highest priority / runs last) and `src/agents/adapters/{claude-code,codex}/` implementing `AgentAdapter`: `paths`; `render` per slice (rules-mirror → CLAUDE.md/AGENTS.md, mcp → `.mcp.json`/`.codex/config.toml`, hooks → `.claude/settings.json`/`.codex/hooks.json`, skills → link `.agnos/skills`); `scrape` per slice; `claims`.
- [ ] **[→ M8]** Replace `orchestrator.initializeAgentsInterleaved` (domain-outer/agent-inner) + `buildAgentDomainStates` with **agent-outer / slice-inner** rendering reading resolved config + canonical outputs. Retire `handles.<domain>`, `DomainEventHandlers`, `AgentPaths`. _Relocated to M8: the render machinery (`renderAgent`) is built and unit-tested here, but swapping the orchestrator + retiring `handles` breaks `commands/*` callers that only compile after the CLI cutover._
- [x] §13.1: render **atomic per slice**, slice failure **warns + continues** (idempotent byte-stable writes and the pre-existing-non-agnos-target guard land with the M8 wiring).
- [x] §13.2 remove/cleanup: **delete files first, then edit config**; `claims`-based retention (delete only the removed agent's paths not claimed by any _remaining_ agent); canonical rules files never claimed; user-edited rendered files still deleted.
- [ ] **[→ M8]** `agnos.json#agents` schema; `agents add [<agent>]` (bare → picker; **no npm install**) and `remove <agent>`. Move `commands/agents.ts` picker → agents `initSteps`/`commands`. Refit/retire `reinstate`/`activateAgent`/`cleanupAgent`. _Relocated to M8 (CLI cutover): schema exists (M2); the commands/picker require the new router._

**Gate:** adapter `render`/`scrape`/`claims` round-trip unit tests for claude-code + codex; cleanup/claims tests. **— MET** (17 tests: `test/agents/{hooks-map,adapters,cleanup}.test.ts`).

---

## M4 — rules domain (inject-by-title)

**Goal:** `rules.files` titled-section injection into canonical files.

- [x] Rewrite `src/domains/rules/`: read `rules.files`, inject/replace titled sections into each canonical file using **HTML sentinels keyed by title slug** (PRD §6.2). (`inject.ts` engine + `injectRules`.)
- [x] §13.3: missing/duplicate `title` → warn (exact format) + skip; section order = declaration order; `fragment → {canonical files}` fan-out re-injection; sentinel-scoped orphan pruning (hand edits left to the owner); idempotent byte-stable replace.
- [x] `rules --init`: prompt `canonicalRulesFilePath` (default `./AGENTS.md`), seed `{ "<path>": [] }`.
- [ ] **[→ M8]** Delete `materialize-rules.ts` (tree machinery) and `domain-docs/cli/inject.ts` (docs no longer self-injects). _Deferred: the core barrel + orchestrator still load `materialize-rules.ts` at runtime; safe to delete only when the orchestrator is rewritten (M8). New rules path doesn't use it._

**Gate (M4):** inject/replace/prune/fan-out + missing/duplicate-title unit tests. **— MET** (10 tests: `test/rules/{inject,rules-domain}.test.ts`).

**Gate:** inject/replace/prune/fan-out + missing/duplicate-title unit tests.

---

## M5 — docs domain (compile index)

**Goal:** `{root, metadata}` → one deterministic index file, surfaced via `rules.files`.

- [x] Rewrite `src/domains/docs/`: watch `root`; parse frontmatter; `metadata` **merges onto** opinionated defaults (title/description/read_when/agent_cant); compile a **deterministic, byte-stable** index (groups by dir A→Z, items by `title` A→Z; fixed formatting) into `root`; **self-exclude** the index from the scan; write a `title` into the index frontmatter so it can be listed in `rules.files`.
- [x] §13.6 metadata validation → **warn + continue** (exact format). Drop `content.md`/`doc-rules.md`/`injectIndex`/`injectRules` code; `route`→`root`.
- [x] `docs --init`: prompt `root` (default `.docs`).

**Gate:** index-compile + metadata-merge + byte-stable-determinism unit tests.

---

## M6 — skills domain (separable prep pipeline)

**Goal:** `fetch → version → integrity → install` as separable subcommands with bucketed reporting.

- [x] `pipeline.ts`: per-skill short-circuit in precedence order `fetch → version → integrity → install`; aggregate failures into the exact `Skills need to be updated: <n> moved   <m> changed   <k> outdated` → `agnos skills update` report (§13.5). _(Engine + `SkillSteps` seam; real step bodies wired in M8.)_
- [ ] **[→ M8]** `version` = no-cache resolve vs `resolvedCommit`/`ref`; `integrity` = hash vs `computedHash`; `install` = **copy-if-absent-or-changed**; `update` re-pins + installs. _Real step bodies (fetcher/git/fs) + the `fetch|version|integrity|install|update` subcommands need the CLI router + fetcher integration._
- [x] `migrate` policy reconciler (`mergeSkillSources`: `--missing/--force/--skip`, conflict = same name/different source). **[→ M8]** the `--init` scrape+prompt and skills.sh `skills-lock.json` fold need the CLI.
- [ ] **[→ M8]** Add skills to the scrape/reverse-import path via adapters.

**Gate (M6):** pipeline bucket tests, migrate-policy tests, lock-shape (`resolvedCommit`/`ref`, via M2 `lockFileSchema`). **— MET** (7 tests: `test/skills/pipeline.test.ts`).

---

## M7 — mcp + hooks domains

**Goal:** the two remaining writers + their reverse-import.

- [ ] mcp: `add`/`remove`/`update`/`migrate`; rendering via adapters (`.mcp.json` / `.codex/config.toml`); `scrape`.
- [ ] hooks: flat-array schema; **closed normalized event vocabulary** mapped per adapter (skip unsupported); identity `(event, matcher, command)`; `add` (interactive), `remove [<id>]` (multiselect if no id), `migrate`; render **regroups** into native formats; strict 5 fields (`message`→native status; drop agent-specific keys).
- [ ] §13.5 reverse-import: mcp identity = `name`, hooks identity = `(event,matcher,command)`; `--missing/--force/--skip` + no-flag single-strategy prompt.

**Gate:** mcp/hooks render + scrape + migrate identity/dedup unit tests.

---

## M8 — Watch supervisor + run pipeline + CLI cutover

**Goal:** tie writers/reader together; full e2e green.

- [ ] Implement `GLOBAL_FLAGS` + two-pass parser + registry-driven router (PRD §4.1) in `src/cli.ts`; **generated `--help`**; `--dry` ⇒ `--once`; `-y` → `yes`. Remove `--dry-run`/`--yes` and the standalone `init`/`install` commands.
- [ ] Run pipeline order **skills-prepare → docs-compile → rules-inject → agents-render** for `agnos`, `agnos <domain>`, and `--once`.
- [ ] Supervisor watches `agnos.json` → **debounced full teardown→rebuild** (§13.4); per-domain watchers: rules (injectable files, incl. the docs index), docs (`docs.root`), agents (derived canonical outputs); skills/mcp/hooks have no watch loop; structural **feedback-loop guard** (agents only link canonical rules files, never overwrite).
- [ ] `--init` / `--init --y`: full + scoped bootstrap via `initSteps` in priority order.
- [ ] §13.7: `--dry` gates **every** write across all pipelines.
- [ ] **(from M3)** Replace `orchestrator.initializeAgentsInterleaved` + `buildAgentDomainStates` with the agent-outer `renderAgent` loop; retire `handles.<domain>`/`DomainEventHandlers`/`AgentPaths`; add idempotent byte-stable writes + the pre-existing-non-agnos-target guard (§13.1).
- [ ] **(from M3)** `agents add [<agent>]` (picker, no npm install) and `remove <agent>` via the agents domain; move `commands/agents.ts` picker → `initSteps`/`commands`; refit/retire `reinstate`/`activateAgent`/`cleanupAgent`.

**Gate:** PRD §12 e2e smoke green; watch cascade settles (no infinite re-render); `pnpm build/typecheck/test/lint` green.

---

## M9 — Release, deprecation, docs

**Goal:** ship 0.1.0; retire the old packages.

- [ ] Bump to **0.1.0**; publish single `@luxia/agnos`; `npm deprecate "@luxia/core@*"` + the 6 plugin packages with a message pointing to `@luxia/agnos`.
- [ ] Rewrite root `README.md` + `AGENTS.md` (drop multi-package/plugin-framework framing); remove stale `packages/*` READMEs.
- [ ] Update project memory to the shipped state.

**Gate:** published 0.1.0 installs + runs in a clean project; deprecation notices visible on npm.

---

## Verification

- **Per-milestone gates** as above (each milestone's unit tests + the M1/M8 build-green gates).
- **End-to-end (PRD §12), at M8:** in a scratch project — `agnos --init --y` → valid config + materialized files; `agnos skills migrate --missing` / `mcp add` / `hooks add` → correct `agnos.json` writes; `agnos` watch-all: edit a doc → index recompiles → rules re-injects `./AGENTS.md` → `CLAUDE.md` re-mirrors, and `agnos skill add X` from a second terminal restarts watchers and links the skill; `agnos --dry` writes nothing (diff the tree); `agnos agents remove codex` removes Codex files + updates `agents`.
- **Cross-OS:** symlink probe + copy fallback on Windows-without-Developer-Mode must survive (existing behavior).

## Risks / notes

- **Template bundling (M1)** is the single highest-risk item — tsup won't copy `.md` templates by default and the `import.meta.url` offsets shift in the emitted layout. Verify against `dist`, not source.
- **Branch is non-green on old behavior from M2 until M8** — by design (greenfield). Keep each area unit-green; the full pipeline returns at M8.
- **Orchestrator inversion (M3)** is the largest single change and unblocks M4–M7.
- **PRD §11 open items** still need decisions during implementation: finalize the hook-event vocabulary against the real Claude/Codex event names, confirm the rules section-marker syntax, and the `--init --y` default agent set.
