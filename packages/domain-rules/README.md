# @luxia/domain-rules

[![npm version](https://img.shields.io/npm/v/@luxia/domain-rules?color=18181B&label=npm&style=flat-square)](https://www.npmjs.com/package/@luxia/domain-rules)
[![license](https://img.shields.io/npm/l/@luxia/domain-rules?color=18181B&style=flat-square)](https://github.com/rgdevme/luxia/blob/main/LICENSE)

[agnos](https://github.com/rgdevme/luxia) domain plugin that owns the **rules** category: a single project-wide instructions file that every active agent should read.

## What it does

- Owns the `rules` field in `agnos.json`.
- Resolves `agnos.json#rules.source` to an absolute path and hands it to each agent's `handles.rules.onInitialize`.
- Creates the rules file on disk if it does not exist (so a fresh project ends up with a starter `AGENTS.md`).
- Implements `move` so `agnos rules <new-path>` can relocate the file safely.

The default location is `./AGENTS.md`. Override it with `agnos rules ./docs/agents.md` or by editing `agnos.json` directly.

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
  "rules": { "source": "./AGENTS.md" }
}
```

`source` is project-relative. The file is created on first install if missing.

## CLI

| Command              | What it does                                                                 |
| -------------------- | ---------------------------------------------------------------------------- |
| `agnos rules`        | Show the current rules source.                                               |
| `agnos rules <path>` | Set or relocate the rules source. Existing content is moved, not duplicated. |

## License

MIT.
