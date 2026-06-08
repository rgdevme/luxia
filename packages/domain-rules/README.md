# @luxia/domain-rules

[![npm version](https://img.shields.io/npm/v/@luxia/domain-rules?color=18181B&label=npm&style=flat-square)](https://www.npmjs.com/package/@luxia/domain-rules)
[![license](https://img.shields.io/npm/l/@luxia/domain-rules?color=18181B&style=flat-square)](https://github.com/rgdevme/luxia/blob/main/LICENSE)

[agnos](https://github.com/rgdevme/luxia) domain plugin that owns the **rules** category: a single project-wide instructions file that every active agent should read.

## What it does

- Owns the `rules` field in `agnos.json`.
- Resolves the full set of canonical rule files — the root file plus every nested `dirs` entry — and hands them to each agent's `handles.rules.onInitialize` as an array.
- Creates the root rules file on disk if it does not exist (so a fresh project ends up with a starter `AGENTS.md`); `agnos rules add <dir>` seeds nested ones.

Each active agent mirrors every canonical file under its own root, using its own filename — so Claude gets a `CLAUDE.md` next to each `AGENTS.md`, while Codex (which reads `AGENTS.md` natively) needs no mirror when the canonical root is `.`. Because agents walk the directory tree and concatenate what they find, agnos never concatenates — it preserves the hierarchy and mirrors each node.

### Nested rules

Some monorepos want rule files at several levels — `./AGENTS.md`, `./packages/a/AGENTS.md`, … List the extra directories in `dirs`. The canonical sources can also live in a separate tree (e.g. under `./docs`) to keep the codebase clean, while agents still see mirrors at the real locations:

```jsonc
{
  "rules": {
    "filename": "AGENTS.md",
    "root": "./docs",
    "dirs": ["./packages/a", "./packages/b"],
  },
}
```

Canonical: `./docs/packages/a/AGENTS.md`. Materialized for Codex: `./packages/a/AGENTS.md` (a symlink); for Claude: `./packages/a/CLAUDE.md`.

## Why a domain for one file?

Because every agent has a different opinion about what to call it: Claude Code wants `CLAUDE.md`, Codex wants `AGENTS.md`, Cursor wants `.cursorrules`, and the next tool will invent something new. agnos keeps one canonical source and lets each agent plugin decide how to expose it (symlink, copy, or in-place if the names already match).

## Install

You usually get this for free with [`@luxia/agnos`](../agnos/README.md). Standalone:

```sh
pnpm add -D @luxia/domain-rules
```

## Configuration

```json
{
  "rules": { "filename": "AGENTS.md", "root": ".", "dirs": [] }
}
```

- `filename` — canonical basename for every rule file (default `AGENTS.md`). Keep it agent-neutral.
- `root` — base directory for canonical sources (default `.`). The root file is `<root>/<filename>`.
- `dirs` — additional directories (relative to `root`) that each hold a `<filename>`; may contain `..`. Defaults to `[]` (a single root file).

## CLI

| Command                    | What it does                                                             |
| -------------------------- | ------------------------------------------------------------------------ |
| `agnos rules`              | Show the current filename, root, and resolved rule files.                |
| `agnos rules <path>`       | Set or relocate the **root** rule file (`root` + `filename`).            |
| `agnos rules add <dir>`    | Add a nested rules directory, seed its `<filename>`, and re-materialize. |
| `agnos rules remove <dir>` | Stop managing a nested directory and prune each agent's mirror for it.   |

## License

MIT.
