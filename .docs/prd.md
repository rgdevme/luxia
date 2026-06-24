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

| Domain   | Subcommands                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------- |
| `docs`   | (run only; config edited manually)                                                                |
| `rules`  | (run only; config edited manually)                                                                |
| `skills` | `fetch` · `version` · `integrity` · `install` · `update` · `migrate [--missing\|--force\|--skip]` |
| `mcp`    | `add` · `remove` · `update` · `migrate [--missing\|--force\|--skip]`                              |
| `hooks`  | `add` · `remove [<id>]` · `migrate [--missing\|--force\|--skip]`                                  |
| `agents` | `add [<agent>]` · `remove <agent>`                                                                |

**Removed**: standalone `agnos init` (→ `agnos --init`), `agnos install` (→ `agnos --once`), `--dry-run`, `--yes`. `--debug`, `--cwd`, `--copy-on-no-symlink` are retained.

### 4.1 CLI declaration model

Commands and flags are **declared**, not hand-parsed. Two layers — **global flags** declared once (every command inherits them) and **per-domain command specs**. minimist remains the tokenizer; a thin spec-driven validator checks tokens and the registry drives dispatch and `--help`. This is an evolution of today's `DomainPlugin.cli: Record<string, CliCommand>` + `initSteps`, with flags/args promoted from an untyped `Record<string, unknown>` to declared specs and a uniform `run`.

**Spec types**

```ts
type FlagType = "boolean" | "string";

interface FlagSpec {
  name: string; // canonical long form, e.g. "dry", "missing"
  type: FlagType;
  alias?: string; // short, e.g. "y"
  description: string; // feeds --help
  default?: boolean | string;
}

interface ArgSpec {
  name: string; // positional, e.g. "<agent>"
  required: boolean;
  variadic?: boolean;
  description: string;
}

interface CommandSpec {
  name: string; // subcommand, e.g. "migrate"
  description: string;
  args?: ArgSpec[]; // positionals
  flags?: FlagSpec[]; // LOCAL flags, on top of the globals
  run(ctx: CommandContext): Promise<void>;
}

interface Domain {
  id: string; // "skills"
  description: string;
  kind: "writer" | "reader";
  priority: number; // run/init ordering (skills=10 … agents=99)

  // Default action for `agnos <domain>` with no subcommand — the watch/once
  // "process". Returns a RunHandle in watch mode; void under --once.
  run?(ctx: RunContext): Promise<void> | RunHandle;

  initSteps?: InitStep[]; // executed by --init, in priority order
  commands?: Record<string, CommandSpec>; // `agnos <domain> <sub> …`
}
```

**Global flags** — declared once, inherited by every command:

```ts
const GLOBAL_FLAGS: FlagSpec[] = [
  { name: "dry", type: "boolean", description: "resolve + log, no writes (implies --once)" },
  { name: "once", type: "boolean", description: "single pass, no watchers" },
  { name: "quiet", type: "boolean", description: "errors only" },
  { name: "help", type: "boolean", description: "show usage" },
  { name: "init", type: "boolean", description: "bootstrap (all domains, or the named one)" },
  { name: "yes", type: "boolean", alias: "y", description: "accept defaults / non-interactive" },
  // retained, off the surface line: --debug, --cwd <dir>, --copy-on-no-symlink
];
```

**A domain declares itself** (skills shown; `docs`/`rules` are run-only with no `commands`; `mcp`/`hooks` have `commands` + a no-op `run` that points at the subcommands):

```ts
export const skills: Domain = {
  id: "skills",
  description: "Manage installed skills",
  kind: "writer",
  priority: 10,
  run: (ctx) => prepareSkills(ctx), // fetch → version → integrity → install
  initSteps: [scrapeRepoForSkillsStep],
  commands: {
    fetch: { name: "fetch", description: "Validate skill sources exist", run: skillsFetch },
    version: {
      name: "version",
      description: "Check skills are on the latest commit",
      run: skillsVersion,
    },
    integrity: {
      name: "integrity",
      description: "Verify content matches the lock",
      run: skillsIntegrity,
    },
    install: { name: "install", description: "Copy skills into .agnos/skills", run: skillsInstall },
    update: { name: "update", description: "Re-pin + install outdated/changed", run: skillsUpdate },
    migrate: {
      name: "migrate",
      description: "Import skills found in the repo into agnos.json",
      flags: [
        { name: "missing", type: "boolean", description: "add only missing" },
        { name: "force", type: "boolean", description: "overwrite conflicts" },
        { name: "skip", type: "boolean", description: "abort on any conflict" },
      ],
      run: skillsMigrate,
    },
  },
};
```

**Registry** just lists them:

```ts
// src/registry.ts
export const DOMAINS: Domain[] = [docs, rules, skills, mcp, hooks, agents];
export const AGENT_ADAPTERS: AgentAdapter[] = [claudeCode, codex];
```

**Dispatch + parsing** is two-pass, because local flags depend on the resolved subcommand:

```ts
function main(argv: string[]) {
  // Pass 1: tokenize with globals only, to discover domain + subcommand.
  const t = minimist(argv, toMinimist(GLOBAL_FLAGS));
  const [domainId, maybeSub, ...rest] = t._;
  const flags = normalize(t); // --dry ⇒ --once; map -y → yes

  if (!domainId) {
    if (flags.help) return printRootHelp(DOMAINS, GLOBAL_FLAGS);
    if (flags.init) return runInitAll(flags);
    return runAll(flags); // watch all (or single pass under --once)
  }

  const domain = byId(domainId) ?? die(`unknown domain "${domainId}"`);
  if (flags.help) return printDomainHelp(domain, GLOBAL_FLAGS);
  if (flags.init) return runInit(domain, flags); // scoped bootstrap

  const cmd = maybeSub ? domain.commands?.[maybeSub] : undefined;
  if (cmd) {
    // Pass 2: re-parse `rest` against globals + this command's local flags.
    const parsed = parseAgainst(cmd, rest, GLOBAL_FLAGS); // validates args + flags, rejects unknowns
    return cmd.run(makeCtx(parsed));
  }
  if (maybeSub) die(`unknown subcommand "${maybeSub}" for ${domainId}`);

  return domain.run?.(makeCtx(flags)) ?? printDomainHelp(domain, GLOBAL_FLAGS);
}
```

Parsed flags flow into handlers via the contexts:

```ts
interface ParsedFlags {
  dry: boolean;
  once: boolean;
  quiet: boolean;
  help: boolean;
  init: boolean;
  yes: boolean;
  [local: string]: unknown;
}
interface RunContext extends ResolveContext {
  flags: ParsedFlags;
}
interface CommandContext extends ResolveContext {
  args: string[];
  flags: ParsedFlags;
}
```

**Properties this gives us**

- **`--help` is generated**, not hand-written: iterate `GLOBAL_FLAGS` + `domain.commands[*].{args,flags}`.
- **Uniform flags are structural** — the parser always merges `GLOBAL_FLAGS`, so `agnos skills migrate --dry --quiet` works without a domain re-declaring them; a domain only declares what's _extra_.
- **Validation is spec-driven** — unknown flags, missing required positionals, and mutually-exclusive sets (`--missing`/`--force`/`--skip`) are checked in `parseAgainst` against the declarations.

## 5. Watch / supervisor model

- A top-level **supervisor watches `agnos.json`**. On any change it **tears down and restarts every active watcher**, guaranteeing idempotency and picking up new config. This makes "`agnos` running in one terminal, `agnos skill add X` in another" safe.
- Content domains **never watch `agnos.json`**:
  - **rules** reads the config once to learn its injectable paths, then watches only those files; re-injects titled sections into the canonical file on change.
  - **docs** watches only files under `docs.root`; recompiles the index on change.
  - **skills/mcp/hooks** are pure writers — they have no watch loop (their bare `--once`/watch run is a no-op that points the user at their subcommands; `skills` additionally re-prepares `.agnos/skills/`).
  - **agents** reads `agnos.json` + watches the **derived canonical outputs** (the rules file(s), the docs index) so a rules/docs re-injection cascades into a per-agent re-render.
- **Run pipeline order** (for `--once` and the initial paint of watch-all): `skills`-prepare → `docs`-compile → `rules`-inject → `agents`-render. The `skills`-prepare step is itself a four-stage pipeline (`fetch → version → integrity → install`; see §6.3). Priorities encode this; `mcp`/`hooks` contribute no run-phase work (only `agents` reads their slices).

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
- **Behavior**: subcommands write `sources` into `agnos.json`; the preparation pipeline materializes skills into the canonical `.agnos/skills/`. The agents domain links the canonical dir per agent.

- **Preparation pipeline** — four **separable subcommands**, runnable individually for testing and run in order as the `skills`-prepare stage of the initial pass. Each step runs **per skill**; on the first failing step the pipeline **stops for that skill** (no later step runs), so a skill lands in exactly one bucket — no double counting.

  | #   | Command                  | Validates                                                                             | Failure bucket                                                                                                     |
  | --- | ------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
  | 1   | `agnos skills fetch`     | the source resolves and the skill dir exists at its sub-path                          | **moved** (source moved/removed upstream)                                                                          |
  | 2   | `agnos skills version`   | the resolved commit is still upstream's latest for the tracked ref (no-cache resolve) | **outdated** (latest commit changed)                                                                               |
  | 3   | `agnos skills integrity` | fetched content hash matches the locked `computedHash`                                | **changed** (upstream content changed)                                                                             |
  | 4   | `agnos skills install`   | —                                                                                     | copies bytes into `.agnos/skills/<name>`, removing stale ones; **copy-if-absent-or-changed**, not overwrite-always |

  Precedence is **fetch → version → integrity → install**: a moved skill is never version/integrity-checked; an outdated skill is never integrity-checked. (Consequence: a skill that is both outdated _and_ changed is reported as **outdated**, since `version` runs first.)

- **Aggregated reporting**: steps 1–3 do not throw per-skill; failures are collected across all skills and presented once, then the pipeline halts before `install`:

  ```
  Skills need to be updated: <n> moved   <m> changed   <k> outdated
  Please run: agnos skills update
  ```

  If every skill passes 1–3, `install` runs and materializes the canonical `.agnos/skills/`.

- **Lock shape change** (`.agnos/lock.json`): add **`resolvedCommit`** (the SHA the skill resolved to) and **`ref`** (the tracked symbolic ref, e.g. branch/tag) alongside the existing `computedHash` + `resolvedAt`. `version` compares against `resolvedCommit`/`ref`; `integrity` compares against `computedHash`; `resolvedAt` stays informational. (`file:` local sources have no commit — `version` is a no-op for them; `integrity` still guards in-place edits.)

- **`--init`**: create an empty `skills` object, **scrape the repo for existing skills** (each agent adapter contributes a scan of its native location, e.g. `.claude/skills`), and if any are found prompt to migrate.
- **`migrate`**: `--missing` (add only names absent from config) · `--force` (overwrite conflicts) · `--skip` (abort on any conflict). With no flag, if any conflicts are found, prompt **once** to choose a single strategy (add-missing / overwrite-all / abort) applied to **all** conflicts. The existing skills.sh `skills-lock.json` import is folded in: if a lock file is present, offer it as a migration source.
- **`update`**: the remediation the aggregated report points to — re-resolve and re-pin outdated/changed skills, updating `resolvedCommit`/`computedHash`/`resolvedAt`, then `install`.

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

## 13. Pipeline semantics (hardening)

Cross-cutting rules for the multi-step flows. Three recurring themes: **atomic-per-unit with warn-and-continue**, **byte-stable idempotent writes**, and **filesystem-decoupled cascades**.

### 13.1 Agents render

- **Granularity**: rendering is **atomic per slice** (rules-mirror / mcp / hooks / skills-link) per agent. A slice failure **warns with the reason and continues** to the next slice/agent — it never aborts the pipeline or the process.
- **Idempotency (required)**: every render is byte-stable — re-rendering unchanged inputs produces identical bytes (deterministic key order, fixed formatting, trailing newline) so it no-ops and doesn't re-trigger watchers.
- **Pre-existing, non-agnos targets**: if a target file exists and wasn't written by agnos, **do not overwrite** — warn and point the user to `agnos <domain> migrate` (reverse-import it instead of clobbering).
- **Degraded inputs**: a non-empty skills error bucket (or a docs/rules warning) does **not** block render — warn and render as usual with whatever is on disk.

### 13.2 Agents remove / cleanup

- **Order**: delete the agent's files **first**, then edit `agnos.json#agents`. (A crash mid-way leaves an orphaned config entry that the next run reconciles — safer than dangling files with no config record.)
- **Shared artifacts via claims**: each adapter exposes the paths it owns (`claims(slice, ctx) → string[]`). On remove, the agents domain computes the union of claims of the **remaining** active agents and deletes only the removed agent's paths **not** in that set. Canonical rules files are never claimed (agents only read/link them), so they're never deleted here. This is the "agents communicate" model — and since `agnos --once` would recreate any shared artifact, the claims check is an optimization (avoids churn + a missing-artifact window), not a correctness crutch.
- **User edits**: a rendered file the user later edited **is still deleted** on remove (it's an agnos-owned output path).

### 13.3 Rules injection

- **Missing / duplicate `title`**: **warn and skip** that injection (continue with the rest). Warning lists the offending paths and the required shape:
  ```
  The following files are missing some metadata properties:
  <rules-injectable metadata shape with descriptions>
  - <filepath>: <comma-separated missing properties>
  ```
  Duplicate titles (same slug into one canonical file) are reported the same way and both are skipped.
- **Idempotent, byte-stable** sentinel replacement (no rewrite when content is unchanged).
- **Fan-out** (`rules.files` is many-to-many):
  - one canonical file aggregates **many fragments** → sections are ordered by **declaration order in the `rules.files` array** (stable);
  - one fragment may be listed under **many canonical files** → a single fragment change re-injects into **each** canonical file that references it. The rules watcher keeps a `fragment → {canonical files}` map.
- **Orphan pruning**: agnos prunes only its own sentinel-delimited sections when a fragment leaves `rules.files`. Content **outside** the sentinels (hand edits) is the owner's responsibility.

### 13.4 Watch supervisor & cascade

- **Decoupled cascade (efficient & correct)**: domains never call each other — they communicate through the filesystem. The rules watcher watches exactly the paths in `rules.files[*]`, including a docs-produced file like `.docs/index.md`; when docs recompiles it, the rules watcher fires like for any other change and re-injects. Efficient (chokidar is event-driven, watches specific paths, no polling) and keeps docs/rules ignorant of each other. Requirements: `awaitWriteFinish` (never read a half-written file) and byte-stable writers (an unchanged recompile emits no downstream event, terminating the cascade).
- **Feedback-loop guard (structural)**: agents **never write canonical rules files — they only link** them to per-agent filenames. If symlink permission is denied and a copy fallback is required, agents **refuse to overwrite** any file declared as a canonical rules file. So the `rules-writes-canonical → agents-write` loop cannot form: only rules writes canonical files; agents only produce _other_ paths (CLAUDE.md, etc.).
- **Restart semantics**: the watch set is _derived from config_, so a change to `agnos.json` can change _what_ is watched. Instead of diffing watch paths, the supervisor does a full **teardown → rebuild**: (1) cancel any in-flight render and close all watchers, (2) reload + validate `agnos.json`, (3) re-run the initial pass for a consistent baseline, (4) start fresh watchers from the new config. The config change is debounced (`awaitWriteFinish`) so a multi-write save is one restart, and concurrent restarts coalesce. Full restart (vs surgical diff) is the chosen idempotency guarantee: running state always matches the on-disk config.

### 13.5 Reverse-import (migrate / scrape) — mcp & hooks

Same shape as skills migrate, parameterized by a per-domain **identity**.

- **Scrape source**: each agent adapter's `scrape` reads that agent's native file and returns declarations in canonical agnos shape.
  - mcp: claude-code reads `.mcp.json`; codex reads `.codex/config.toml#mcp_servers` → `McpDeclaration[]`.
  - hooks: claude-code reads `.claude/settings.json#hooks` (record) and **flattens** to `{ event, matcher, type, command, message }[]`; codex reads `.codex/hooks.json`.
- **Identity (dedup key)**: mcp → `name`; hooks → `(event, matcher, command)`.
- **Merge**: union scraped items across adapters, dedup by identity, reconcile against existing `agnos.json` entries with the policy flags — `--missing` (add only absent identities) · `--force` (overwrite matching + add absent) · `--skip` (abort the whole migrate on any conflict) · **no flag** → if any conflicts are found, prompt **once** to choose a single strategy (add-missing / overwrite-all / abort) applied to **all** conflicts (not one prompt per conflict). A **conflict** = same identity, differing payload; identical payload is a silent no-op.

```ts
const IDENTITY = {
  mcp: (d) => d.name,
  hooks: (h) => `${h.event} ${h.matcher ?? ""} ${h.command}`,
};
function migrate(domain, policy, ctx) {
  const scraped = dedupe(
    AGENT_ADAPTERS.flatMap((a) => a.scrape?.[domain]?.(ctx) ?? []),
    IDENTITY[domain],
  );
  for (const item of scraped) {
    const match = config[domain].find((e) => IDENTITY[domain](e) === IDENTITY[domain](item));
    if (!match)
      add(domain, item); // missing
    else if (equal(match, item))
      continue; // no-op
    else resolve(policy, match, item); // missing | force | skip
  }
}
```

### 13.6 Docs compile

- **Metadata validation**: missing declared keys **warn and continue** indexing (the doc is still indexed). Same warning format as rules:
  ```
  The following files are missing some metadata properties:
  <docs metadata shape with descriptions>
  - <filepath>: <comma-separated missing properties>
  ```
- **Self-exclusion**: the generated index file is excluded from its own scan.
- **Deterministic, byte-stable output**: grouping and ordering are fixed (groups sorted by dir name, items by title within a group, constant link/whitespace formatting) so unchanged docs always produce identical index bytes. A non-deterministic index (e.g. `readdir`/inode order) would change bytes on every recompile, needlessly firing the rules watcher → agents re-mirror, with noisy git diffs. Determinism is the precondition for the "no-op on unchanged" guard that terminates the cascade.

### 13.7 Dry-run

`--dry` gates **every** write in all the above — config mutations, canonical files, per-agent renders, skill fetch/copy, link creation — logging `would:` lines instead. A property every step must honor, not a separate flow.
