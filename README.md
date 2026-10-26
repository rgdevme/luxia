<p align="center">
  <img src=".github/assets/banner.svg" alt="agnos" width="640" />
</p>

<p align="center">
  <strong>One config. Every coding agent.</strong>
  <br/>
  <sub>Project-level configuration for AI coding harnesses, materialized into whatever each tool expects to find on disk.</sub>
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

**agnos maintains repository configuration for coding harnesses.** You declare documentation, rules, skills, repository references, and MCP servers in one `agnos.json`. Agnos composes or links that repository content into the files each configured harness reads, and translates shared MCP declarations into each harness's native format.

agnos ships as a **single package** (`@luxia/agnos`) with built-in harnesses for Claude Code, Codex, and Gemini CLI. Its domains manage repository-bound configuration. Each harness adapter handles the native files and compatibility details for that harness.

## What does it solve?

Every coding agent invents its own on-disk configuration format. Keeping them consistent by hand is tedious and error-prone:

- **Drift**: `CLAUDE.md` and `AGENTS.md` say different things because you updated one and forgot the other.
- **Duplication**: the same MCP server or rule copied into multiple harness-specific files with different formats.
- **Onboarding cost**: adding a new agent to a repo means learning yet another file layout and hand-translating everything you already wrote.
- **No single source of truth**: nothing in the repo tells you what the _intended_ configuration is; it's scattered across whatever files each tool happens to read.

agnos keeps repository configuration in one place and renders it for selected harnesses. Harness-specific permissions and hooks remain owned by each harness.

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
  - [`harness`](#harness)
- [Active development](#active-development)
- [Contributing](#contributing)
- [License](#license)

## Features

- 🎯 **One source of truth**: declare docs, rules, skills, repository references, and MCP servers once in `agnos.json`.
- 🔌 **Multi-agent output**: renders native files for Claude Code, OpenAI Codex, and Gemini CLI from the same config.
- 👀 **Watch mode**: a per-domain watcher tree keeps harness files in sync as your sources change; edit a rule fragment and the canonical files re-render.
- 🧩 **Generated rules**: build complete rules artifacts from ordered Markdown sources, with validation before replacing generated output.
- 📚 **Docs index**: compile a metadata index from your docs directory and surface it to agents.
- 📦 **Skills management**: fetch, pin, verify, and update agent skills from GitHub/GitLab/Bitbucket or local paths, linked per-harness.
- 🛰️ **MCP registry integration**: search and add MCP servers from the registry, or configure them manually; agnos renders them per-harness.
- ♻️ **Import existing MCP servers** from supported harness configuration into `agnos.json`.
- ⚠️ **Skill metadata checks**: warn when skill metadata may not work in a configured harness. Findings never block installation or harness enablement.
- 🧪 **Dry runs**: `--dry` shows exactly what would change without writing anything.

## The model: config writers + one config reader

agnos splits its work in two:

- **Repository domains** manage skills, references, docs, rules, and MCP declarations.
- **The `harness` domain** reads `agnos.json`, then each harness adapter renders supported repository content. Adapters own harness-specific compatibility checks.

```
        ┌──────────── config WRITERS ────────────┐      ┌── reader ──┐
 docs ──▶ .agnos/docs/index.md                           │            │
 rules ─▶ ./AGENTS.md (whole-file generation) ─────────▶│  harness   │──▶ CLAUDE.md, .mcp.json,
 skills ▶ agnos.json#skills + global repository store   │ (adapters) │    .claude/skills, .codex/*,
 mcp ───▶ agnos.json#mcp                                 │            │    .claude/skills, .codex/*
        └─────────────────────────────────────────┘      └────────────┘
```

Domains run in priority order (`skills` → `references` → `docs` → `rules` → `mcp` → `harness`), so repository content is ready before harness files render.

## Installation

Requires **Node.js 24 or newer**. agnos is ESM-only. This project uses **pnpm** exclusively.

```sh
# global (recommended for the CLI)
pnpm add -g @luxia/agnos

# or per-project
pnpm add -D @luxia/agnos
```

## Usage

```sh
cd my-project
agnos --init        # bootstrap agnos.json + pick harnesses (add -y for defaults)
agnos --once        # run the pipeline once: resolve skills → docs → rules → render harnesses
agnos               # watch mode: keep harness files in sync as sources change
```

> **NOTE**: Agnos links skill directories individually into each harness's native skills directory. On Windows these links use junctions. macOS and Linux use directory symlinks.

Typical workflow:

1. **`agnos --init`** creates `agnos.json` and walks you through picking harnesses, a docs root, a rules source directory, a generated rules artifact, and a local skills directory. Add `-y` to accept every default non-interactively.
2. **Edit `agnos.json`** (or use the domain subcommands like `agnos mcp add github` and `agnos skills add owner/repo`) to declare what you want.
3. **`agnos`** in one terminal watches all domains and re-renders on change. Run **`agnos --once`** in CI or a pre-commit hook for a single deterministic pass, or **`agnos --dry`** to preview.

You can also run a single domain: `agnos rules --once`, `agnos docs`, etc.

## Configuration (`agnos.json`)

`agnos --init` walks you through building `agnos.json` interactively; it selects harnesses and configures docs, rules, and local skills. MCP servers, external skills, and references can then be added through their domain commands.

```json
{
  "$schema": "https://unpkg.com/@luxia/agnos/schema.json",
  "schemaVersion": 1,
  "harness": ["claude-code", "codex", "gemini-cli"],
  "docs": { "dir": ".agnos/docs" },
  "rules": {
    "dir": ".agnos/rules",
    "fragments": {
      "./AGENTS.md": [".", "../docs/index.md"]
    }
  },
  "skills": {
    "dir": ".agnos/skills",
    "sources": {
      "pdf": { "source": "github:vercel-labs/agent-skills", "glob": "skills/pdf" }
    }
  },
  "references": { "dir": ".agnos/references", "sources": {} },
  "mcp": {
    "servers": [
      {
        "name": "github",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-github"],
        "env": ["GITHUB_TOKEN"]
      }
    ]
  }
}
```

`agnos.json` is parsed as strict JSON (no comments, no trailing commas), so the block above is copy-pasteable as-is. `${VAR}` placeholders inside `mcp.env`/`mcp.headers` are resolved at render time.

**Field reference** (see [`schema.json`](schema.json) for the authoritative definition):

| Field             | Type                     | Description                                                                                 |
| ----------------- | ------------------------ | ------------------------------------------------------------------------------------------- |
| `schemaVersion`   | `1`                      | Required. Config schema version; must be `1`.                                               |
| `harness`         | `string[]`               | Active harness ids: `"claude-code"`, `"codex"`, `"gemini-cli"`.                             |
| `docs.dir`        | `string`                 | Directory the docs index is compiled from (default `.agnos/docs`).                          |
| `rules.dir`       | `string`                 | Authored rule sources directory (default `.agnos/rules`).                                   |
| `rules.fragments` | `{ [output]: string[] }` | Maps each generated artifact to ordered source files, directories, or glob patterns.        |
| `skills.dir`      | `string`                 | Manually authored skills (default `.agnos/skills`); local skills override external names.   |
| `references.dir`  | `string`                 | Directory where reference repository links are installed (default `.agnos/references`).     |
| `skills.sources`  | `{ [name]: request }`    | Local skill name → normalized request with `source`, optional `branch` or `commit`, `glob`. |
| `mcp`             | `object[]`               | MCP server declarations (`name`, `transport`, `command`, `args`, `env`, `headers`, …).      |

## Commands

```
agnos [domain] [subcommand] [args] [flags]
```

- **`agnos`**: watch all domains and keep harness files in sync.
- **`agnos --once`**: run the full pipeline once and exit.
- **`agnos <domain>`**: run a single domain (`docs`|`rules`|`skills`|`references`|`mcp`|`harness`).
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

Compiles a documentation index from `docs.dir`. Surface it to agents by listing the generated index in `rules.fragments`. No subcommands: configure it via `agnos.json` or `agnos docs --init`.

| Command      | Args | Description                                                  |
| ------------ | ---- | ------------------------------------------------------------ |
| `agnos docs` | none | Compile the docs index (watch mode unless `--once`/`--dry`). |

### `rules`

Generates complete Markdown artifacts from ordered source files, directories, and globs. The optional rules-root `_index.md` may contain one H1; other selected files must not contain H1 headings. Frontmatter is removed, and source bodies are joined. Generated output is overwritten on each successful run. Configure sources and outputs in `agnos.json` or `agnos rules --init`.

| Command                 | Args / Flags                                                     | Description                                                                                                                             |
| ----------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `agnos rules`           | none                                                             | Generate rules artifacts (watch mode unless `--once`/`--dry`).                                                                          |
| `agnos rules bootstrap` | `[source]` &nbsp;·&nbsp; `-p, --provider <p>` &nbsp;·&nbsp; `-y` | Fetch a rules catalog, select Markdown files, and overwrite matching files under `rules.dir`. Omitting `source` uses the Agnos catalog. |

### `skills`

Tracks external skills in the shared global repository store and links selected skill directories directly into each configured agent. Manually authored skills under `skills.dir` (default `.agnos/skills`) override external skills with the same name. Shared live branch updates are visible across projects; explicit commit pins stay fixed. Set `AGNOS_STORE_DIR` to override the operating system data location used by the shared store.

| Subcommand  | Args / Flags                                                                                  | Description                                                                                                                                                                                                                                                |
| ----------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `add`       | `<skills_address...>` &nbsp;·&nbsp; `-p, --provider <p>` &nbsp;·&nbsp; `-s, --skills <names>` | Add skills from one or more sources (`owner/repo[#ref]` or paths); discovers skills and prompts to pick. `--provider` sets the default provider (`github`\|`gitlab`\|`bitbucket`\|`file`) for un-prefixed addresses; `--skills pdf,docx` skips the prompt. |
| `remove`    | `[names...]`                                                                                  | Remove skill sources (multiselect prompt when no name is given).                                                                                                                                                                                           |
| `fetch`     | none                                                                                          | Check that every skill source still resolves (reports moved).                                                                                                                                                                                              |
| `version`   | none                                                                                          | Check whether skills are on their pinned commit (reports outdated).                                                                                                                                                                                        |
| `integrity` | none                                                                                          | Verify skill content matches the lock (reports changed).                                                                                                                                                                                                   |
| `install`   | none                                                                                          | Acquire and verify every declared skill and refresh lock observations.                                                                                                                                                                                     |
| `check`     | `--skills=<names>` `--harness=<id>`                                                           | Check installed skill metadata against configured harnesses; warnings are advisory.                                                                                                                                                                        |
| `update`    | `[names...]`                                                                                  | Advance shared unpinned branch checkouts and refresh lock observations (default: all).                                                                                                                                                                     |
| `migrate`   | `[file]` &nbsp;·&nbsp; `--missing` \| `--force` \| `--skip`                                   | Import skill sources from a lock file (`name → ref` JSON; default `skills-lock.json`).                                                                                                                                                                     |

### `references`

Tracks selected repository directories through the shared global repository store. `references.dir` defaults to `.agnos/references`; adding a declaration creates a directory link there. Reference repositories are not project remotes or submodules, and Agnos does not install their dependencies.

| Command                   | Args / Flags                                                                    | Description                                                                          |
| ------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `agnos references`        | none                                                                            | Check declared reference freshness (watch mode unless `--once`/`--dry`).             |
| `agnos references --init` | none                                                                            | Install declared references and repair their links without advancing live checkouts. |
| `agnos references add`    | `<ref> [--branch <branch>] [--commit <sha>] [--glob <pattern>] [--name <name>]` | Add a repository selection. An omitted branch follows the remote default branch.     |
| `agnos references remove` | `<ref\|ref-name>`                                                               | Remove a declaration, its project link, and its consumer registration.               |
| `agnos references pull`   | `[ref\|ref-name]`                                                               | Update one or all installed live references. Pinned references are skipped.          |

### `mcp`

Manages MCP servers in `agnos.json` (rendered per-harness by the `harness` domain).

| Subcommand | Args / Flags                         | Description                                                                                                           |
| ---------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `add`      | `[term]`                             | Add MCP servers from the registry (search term), or configure one manually (omit the term for an interactive prompt). |
| `update`   | `[names...]`                         | Update registry-managed MCP servers to their latest version (all if none given).                                      |
| `remove`   | `[names...]`                         | Remove MCP servers (multiselect prompt when no name is given).                                                        |
| `migrate`  | `--missing` \| `--force` \| `--skip` | Import MCP servers from the active harnesses' native config.                                                          |

### `harness`

The config reader renders supported repository content for every configured harness. `add` and `remove` update `agnos.json#harness`; removing a harness cleans up only files Agnos owns.

| Subcommand | Args             | Description                                                    |
| ---------- | ---------------- | -------------------------------------------------------------- |
| `add`      | `[harnesses...]` | Enable harnesses. Omit ids to pick interactively.              |
| `remove`   | `[harnesses...]` | Remove Agnos-owned rendered files, then disable the harnesses. |

> **`--missing` / `--force` / `--skip`** (the `migrate` conflict policy): `--missing` (default) adds only entries not already present; `--force` overwrites conflicting entries and adds missing ones; `--skip` aborts if any entry conflicts.

## Active development

⚠️ **agnos is under active development.** The built-in roster is currently **Claude Code**, **OpenAI Codex**, and **Gemini CLI**, with more harnesses planned. Config schema, CLI flags, and rendered output may change between releases: pin a version in CI and read the release notes before upgrading. Feedback and bug reports are very welcome.

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
