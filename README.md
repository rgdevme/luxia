<p align="center">
  <img src=".github/assets/banner.svg" alt="agnos" width="640" />
</p>

<p align="center">
  <strong>One config. Every coding agent.</strong>
  <br/>
  <sub>Project-level configuration for AI coding agents, materialized into whatever each tool expects to find on disk.</sub>
</p>

<p align="center">
  <a href="https://github.com/rgdevme/luxia/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/rgdevme/luxia/ci.yml?branch=main&label=ci&style=flat-square" /></a>
  <a href="https://www.npmjs.com/package/@luxia/agnos"><img alt="downloads" src="https://img.shields.io/npm/dm/@luxia/agnos?color=18181B&style=flat-square" /></a>
  <a href="https://nodejs.org"><img alt="node" src="https://img.shields.io/node/v/@luxia/agnos?color=18181B&style=flat-square" /></a>
  <a href="https://agents.md"><img alt="agent friendly" src="https://img.shields.io/badge/agent-friendly-6E56CF?style=flat-square" /></a>
  <a href="#license"><img alt="license" src="https://img.shields.io/npm/l/@luxia/agnos?color=18181B&style=flat-square" /></a>
</p>

---

## What is agnos?

**agnos is a project-level configuration manager for AI coding agents.** You declare your docs, rules, skills, MCP servers, and hooks once in a single `agnos.json` at the root of your repo. agnos materializes that declaration into whatever each agent expects to find on disk: `CLAUDE.md` + `.mcp.json` + `.claude/settings.json` for **Claude Code**, `AGENTS.md` + `.codex/config.toml` for **OpenAI Codex**, and so on.

agnos ships as a **single package** (`@luxia/agnos`) with a fixed, built-in set of agents (Claude Code, Codex) and domains (docs, rules, skills, mcp, hooks, agents). Point it at your project, run it once, or leave it in watch mode: every agent's files stay in sync with your one source of truth.

## What does it solve?

Every coding agent invents its own on-disk configuration format. Keeping them consistent by hand is tedious and error-prone:

- **Drift**: `CLAUDE.md` and `AGENTS.md` say different things because you updated one and forgot the other.
- **Duplication**: the same MCP server, the same hook, the same rule copied into three tool-specific files with three different syntaxes.
- **Onboarding cost**: adding a new agent to a repo means learning yet another file layout and hand-translating everything you already wrote.
- **No single source of truth**: nothing in the repo tells you what the _intended_ configuration is; it's scattered across whatever files each tool happens to read.

agnos collapses all of that into one declarative `agnos.json`. You edit intent; agnos renders the per-agent reality. Adding an agent becomes "render its files"; removing one becomes "delete its files."

## Table of contents

- [What is agnos?](#what-is-agnos)
- [What does it solve?](#what-does-it-solve)
- [Table of contents](#table-of-contents)
- [Features](#features)
- [The model: config writers + one config reader](#the-model-config-writers--one-config-reader)
- [Installation](#installation)
- [Usage](#usage)
- [Configuration (`agnos.json`)](#configuration-agnosjson)
- [Commands](#commands)
  - [Global flags](#global-flags)
  - [`docs`](#docs)
  - [`rules`](#rules)
  - [`skills`](#skills)
  - [`mcp`](#mcp)
  - [`hooks`](#hooks)
  - [`agents`](#agents)
- [Active development](#active-development)
- [Contributing](#contributing)
- [License](#license)

## Features

- 🎯 **One source of truth**: declare docs, rules, skills, MCP servers, and hooks once in `agnos.json`.
- 🔌 **Multi-agent output**: renders native files for Claude Code and OpenAI Codex from the same config.
- 👀 **Watch mode**: a per-domain watcher tree keeps agent files in sync as your sources change; edit a rule fragment and the canonical files re-render.
- 🧩 **Composable rules**: inject titled sections (by frontmatter `title`) from fragment files into your canonical rules file, preserving your hand-written sections.
- 📚 **Docs index**: compile a metadata index from your docs directory and surface it to agents.
- 📦 **Skills management**: fetch, pin, verify, and update agent skills from GitHub/GitLab/Bitbucket or local paths, linked per-agent.
- 🛰️ **MCP registry integration**: search and add MCP servers from the registry, or configure them manually; agnos renders them per-agent.
- 🪝 **Portable hooks**: declare command hooks once against a normalized event vocabulary; each agent gets them in its native format.
- ♻️ **Migrate what you already have**: import existing MCP servers, hooks, and skills from your agents' current config into `agnos.json`.
- 🧪 **Dry runs**: `--dry` shows exactly what would change without writing anything.

## The model: config writers + one config reader

agnos splits its work in two:

- **Config-writer domains** manage their own slice of the project. `skills`/`mcp`/`hooks` write entries into `agnos.json`; `docs` compiles a documentation index; `rules` injects titled sections into your canonical rules file(s).
- **One config-reader domain, `agents`**: reads `agnos.json` and the canonical outputs and renders **every** per-agent native file via per-agent adapters. Installing an agent is just "render its files"; removing it is "delete its files."

```
        ┌──────────── config WRITERS ────────────┐      ┌── reader ──┐
 docs ──▶ .docs/index.md                                 │            │
 rules ─▶ ./AGENTS.md (titled sections injected) ───────▶│  agents    │──▶ CLAUDE.md, .mcp.json,
 skills ▶ agnos.json#skills + .agnos/skills/             │ (adapters) │    .claude/settings.json,
 mcp ───▶ agnos.json#mcp                                 │            │    .claude/skills, .codex/*
 hooks ─▶ agnos.json#hooks                               │            │
        └─────────────────────────────────────────┘      └────────────┘
```

Domains run in priority order (`skills` → `docs` → `rules` → `mcp` → `hooks` → `agents`), so every writer has produced its canonical output before the reader renders.

## Installation

Requires **Node.js 24 or newer**. agnos is ESM-only.

```sh
# global (recommended for the CLI)
npm i -g @luxia/agnos

# or per-project
npm i -D @luxia/agnos
pnpm add -D @luxia/agnos
```

## Usage

```sh
cd my-project
agnos --init        # bootstrap agnos.json + pick agents (add -y for defaults)
agnos --once        # run the pipeline once: prepare skills → docs → rules → render agents
agnos               # watch mode: keep agent files in sync as sources change
```

> **NOTE**: We recommend running `agnos agents` from an elevated terminal the first time.
>
> This way, it will create sym-links during the agents rendering cycle. Using a non-elevated terminal will use hard links, and fall back to plain copy.
>
> Subsequent runs can be done without elevated priviledges, as the sym-links do not need to updated.

Typical workflow:

1. **`agnos --init`** creates `agnos.json` and walks you through picking agents, a docs root, a rules file, and a skills directory. Add `-y` to accept every default non-interactively.
2. **Edit `agnos.json`** (or use the domain subcommands like `agnos mcp add github` and `agnos skills add owner/repo`) to declare what you want.
3. **`agnos`** in one terminal watches all domains and re-renders on change. Run **`agnos --once`** in CI or a pre-commit hook for a single deterministic pass, or **`agnos --dry`** to preview.

You can also run a single domain: `agnos rules --once`, `agnos docs`, etc.

## Configuration (`agnos.json`)

`agnos --init` writes a minimal starting config. This is the default agnos ships with:

```jsonc
{
  "$schema": "https://unpkg.com/@luxia/agnos/schema.json",
  "schemaVersion": 1,
  "agents": ["claude-code", "codex"],
  "rules": {
    "files": {
      "./AGENTS.md": [],
    },
  },
  "skills": {},
  "mcp": [],
  "docs": { "root": ".docs" },
}
```

A fuller, annotated example showing every domain:

```jsonc
{
  // Recommended so editors validate + autocomplete agnos.json.
  "$schema": "https://unpkg.com/@luxia/agnos/schema.json",
  "schemaVersion": 1,

  // Active agents: their native files are rendered on every run.
  "agents": ["claude-code", "codex"],

  // docs: compile a metadata index from this directory; surface it by
  // listing the generated index in rules.files.
  "docs": { "root": ".docs" },

  // rules: map each canonical rules file to the fragment files whose
  // titled sections (frontmatter `title`) are injected into it.
  "rules": {
    "files": {
      "./AGENTS.md": ["./.docs/index.md", "./.rules/security.md", "./.rules/style.md"],
    },
  },

  // skills: local name → composite source ref.
  //   github:<owner>/<repo>/<path>[#ref] | gitlab: | bitbucket: | file:<path>
  "skills": {
    "route": ".agnos/skills", // optional; where canonical skill bytes live
    "sources": {
      "pdf": "github:vercel-labs/agent-skills/skills/pdf",
      "docx": "github:vercel-labs/agent-skills/skills/docx",
    },
  },

  // mcp: server declarations, rendered into each agent's native MCP config.
  "mcp": [
    {
      "name": "github",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" }, // ${VAR} resolved at render time
    },
  ],

  // hooks: a flat array of command hooks (5 fields, strict). Agents regroup
  // and render each entry into their native format.
  "hooks": [
    {
      "event": "PreToolUse",
      "matcher": "git",
      "type": "command",
      "command": "echo 'about to run git'",
      "message": "checking git usage",
    },
  ],
}
```

**Field reference** (see [`schema.json`](schema.json) for the authoritative definition):

| Field            | Type                        | Description                                                                                  |
| ---------------- | --------------------------- | -------------------------------------------------------------------------------------------- |
| `schemaVersion`  | `1`                         | Required. Config schema version; must be `1`.                                                |
| `agents`         | `string[]`                  | Active agent ids: `"claude-code"`, `"codex"`.                                                |
| `docs.root`      | `string`                    | Directory the docs index is compiled from (default `.docs`).                                 |
| `rules.files`    | `{ [canonical]: string[] }` | Maps each canonical rules file → fragment files whose titled sections are injected into it.  |
| `skills.route`   | `string`                    | Canonical skills directory (default `.agnos/skills`); agents link their own skills dir here. |
| `skills.sources` | `{ [name]: string }`        | Local skill name → composite source ref (`github:`/`gitlab:`/`bitbucket:`/`file:`).          |
| `mcp`            | `object[]`                  | MCP server declarations (`name`, `transport`, `command`, `args`, `env`, `headers`, …).       |
| `hooks`          | `object[]`                  | Flat array of command hooks (`event`, `matcher?`, `type`, `command`, `message?`).            |

## Commands

```
agnos [domain] [subcommand] [args] [flags]
```

- **`agnos`**: watch all domains and keep agent files in sync.
- **`agnos --once`**: run the full pipeline once and exit.
- **`agnos <domain>`**: run a single domain (`docs`|`rules`|`skills`|`mcp`|`hooks`|`agents`).
- **`agnos <domain> <subcommand>`**: mutate config or run a domain action.
- **`agnos <domain> --help`**: show help for a domain and its subcommands.

### Global flags

Available on every command:

| Flag           | Description                                                        |
| -------------- | ------------------------------------------------------------------ |
| `--dry`        | Resolve and log planned actions; write nothing (implies `--once`). |
| `--once`       | Single pass, no watchers.                                          |
| `--quiet`      | Errors only.                                                       |
| `--init`       | Run initialization (bootstrap), then exit.                         |
| `-y`, `--yes`  | Accept defaults (non-interactive).                                 |
| `--cwd <dir>`  | Run as if invoked from `<dir>`.                                    |
| `--debug`      | Print debug output and full stack traces on error.                 |
| `-h`, `--help` | Show help.                                                         |

### `docs`

Compiles a documentation index from `docs.root`. Surface it to agents by listing the generated index in `rules.files`. No subcommands: configure it via `agnos.json` or `agnos docs --init`.

| Command      | Args | Description                                                  |
| ------------ | ---- | ------------------------------------------------------------ |
| `agnos docs` | none | Compile the docs index (watch mode unless `--once`/`--dry`). |

### `rules`

Injects titled sections (by frontmatter `title`) from fragment files into your canonical rules file(s). Hand-written sections are preserved; removed fragments are pruned. No subcommands: configure via `agnos.json` or `agnos rules --init`.

| Command       | Args | Description                                        |
| ------------- | ---- | -------------------------------------------------- |
| `agnos rules` | none | Inject rules (watch mode unless `--once`/`--dry`). |

### `skills`

Fetches, pins, verifies, and installs skills into the canonical skills dir (linked per-agent by `agents`).

| Subcommand  | Args / Flags                                                                                  | Description                                                                                                                                                                                                                                                |
| ----------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `add`       | `<skills_address...>` &nbsp;·&nbsp; `-p, --provider <p>` &nbsp;·&nbsp; `-s, --skills <names>` | Add skills from one or more sources (`owner/repo[#ref]` or paths); discovers skills and prompts to pick. `--provider` sets the default provider (`github`\|`gitlab`\|`bitbucket`\|`file`) for un-prefixed addresses; `--skills pdf,docx` skips the prompt. |
| `remove`    | `[names...]`                                                                                  | Remove skill sources (multiselect prompt when no name is given).                                                                                                                                                                                           |
| `fetch`     | none                                                                                          | Check that every skill source still resolves (reports moved).                                                                                                                                                                                              |
| `version`   | none                                                                                          | Check whether skills are on their pinned commit (reports outdated).                                                                                                                                                                                        |
| `integrity` | none                                                                                          | Verify skill content matches the lock (reports changed).                                                                                                                                                                                                   |
| `install`   | none                                                                                          | Run the prep pipeline (fetch → version → integrity → install).                                                                                                                                                                                             |
| `update`    | `[names...]`                                                                                  | Re-pin + reinstall skills, accepting upstream changes (default: all).                                                                                                                                                                                      |
| `migrate`   | `[file]` &nbsp;·&nbsp; `--missing` \| `--force` \| `--skip`                                   | Import skill sources from a lock file (`name → ref` JSON; default `skills-lock.json`).                                                                                                                                                                     |

### `mcp`

Manages MCP servers in `agnos.json` (rendered per-agent by the `agents` domain).

| Subcommand | Args / Flags                         | Description                                                                                                           |
| ---------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `add`      | `[term]`                             | Add MCP servers from the registry (search term), or configure one manually (omit the term for an interactive prompt). |
| `update`   | `[names...]`                         | Update registry-managed MCP servers to their latest version (all if none given).                                      |
| `remove`   | `[names...]`                         | Remove MCP servers (multiselect prompt when no name is given).                                                        |
| `migrate`  | `--missing` \| `--force` \| `--skip` | Import MCP servers from the active agents' native config.                                                             |

### `hooks`

Manages hooks in `agnos.json` (a flat array; the `agents` domain regroups + renders per-agent).

| Subcommand | Args / Flags                         | Description                                                        |
| ---------- | ------------------------------------ | ------------------------------------------------------------------ |
| `add`      | `<event> <command> [matcher]`        | Add a command hook. `event` is one of the normalized events below. |
| `remove`   | `[event] [command] [matcher]`        | Remove command hooks (multiselect prompt when no args are given).  |
| `migrate`  | `--missing` \| `--force` \| `--skip` | Import hooks from the active agents' native config.                |

Normalized hook events: `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Notification`, `Stop`, `SubagentStop`, `PreCompact`, `SessionStart`, `SessionEnd`. Each agent renders only the events it supports and skips the rest.

### `agents`

The sole config reader: renders every active agent's native files. `add`/`remove` toggle `agnos.json#agents` (remove also cleans up the agent's rendered files).

| Subcommand | Args          | Description                                                                                 |
| ---------- | ------------- | ------------------------------------------------------------------------------------------- |
| `add`      | `[agents...]` | Enable agents (their files render on the next `agnos` run). Omit ids to pick interactively. |
| `remove`   | `[agents...]` | Remove agents' rendered files, then disable them.                                           |

> **`--missing` / `--force` / `--skip`** (the `migrate` conflict policy): `--missing` (default) adds only entries not already present; `--force` overwrites conflicting entries and adds missing ones; `--skip` aborts if any entry conflicts.

## Active development

⚠️ **agnos is under active development.** The built-in roster is currently **Claude Code** and **OpenAI Codex**, with more agents planned. Config schema, CLI flags, and rendered output may change between releases: pin a version in CI and read the release notes before upgrading. Feedback and bug reports are very welcome.

## Contributing

Node 24+, ESM only, TypeScript throughout. Contributions are welcome: issues and PRs at [github.com/rgdevme/luxia](https://github.com/rgdevme/luxia).

```sh
pnpm install
pnpm build          # bundle with tsup + copy templates
pnpm typecheck      # tsc --noEmit
pnpm test           # vitest
pnpm lint           # eslint
pnpm format         # prettier --write
```

CI runs format-check, lint, typecheck, test, and build on every pull request; run the same locally before pushing:

```sh
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Commits are linted via Husky + lint-staged. Please keep changes focused and add tests for new behavior.

## License

Released under the **MIT** license.
