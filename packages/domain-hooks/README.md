# @luxia/domain-hooks

[![npm version](https://img.shields.io/npm/v/@luxia/domain-hooks?color=18181B&label=npm&style=flat-square)](https://www.npmjs.com/package/@luxia/domain-hooks)
[![license](https://img.shields.io/npm/l/@luxia/domain-hooks?color=18181B&style=flat-square)](https://github.com/rgdevme/luxia/blob/main/LICENSE)

[agnos](https://github.com/rgdevme/luxia) domain plugin that owns the **hooks** category. One registry; every agent renders it into its own format and location.

## What it does

- Owns the `hooks` object in `agnos.json`, keyed by hook event name (`PreToolUse`, `SessionStart`, …). The shape mirrors [Claude Code's hook format](https://code.claude.com/docs/en/hooks) — the superset across agents — so it round-trips losslessly.
- Validates the registry against a (permissive) Zod schema: every handler needs a `type`, and unknown fields pass through so agent-specific keys survive.
- Hands the registry to each active agent's `handles.hooks.onInitialize`, which renders the right file:
  - **Claude Code** → merges into `.claude/settings.json` under `hooks`.
  - **Codex** → writes `.codex/hooks.json` (filtered to Codex-supported events / `command` handlers).
- **Reverse-imports** existing hooks: on first activation each agent's `handles.hooks.onImport` reads its native file, and the domain merges new matcher groups into `agnos.json` — skipping anything already declared so nothing is blindly overwritten.

## Install

You usually get this for free with [`@luxia/agnos`](../agnos/README.md). Standalone:

```sh
pnpm add -D @luxia/domain-hooks
```

## Configuration

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "./.agnos/hooks/guard.sh", "timeout": 30 }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [{ "type": "command", "command": "prettier --write" }]
      }
    ]
  }
}
```

- The top-level keys are **event names**. Both Claude Code and Codex understand the same shared core (`PreToolUse`, `PostToolUse`, `PermissionRequest`, `SessionStart`, `SubagentStart`/`Stop`, `PreCompact`/`PostCompact`, `UserPromptSubmit`, `Stop`); Claude Code adds many more.
- Each group has an optional `matcher` and a list of `hooks` handlers.
- Only `type: "command"` is portable to Codex; Claude-only handler types (`http`/`mcp_tool`/`prompt`/`agent`) and events are dropped from the Codex output (with a warning).

## CLI

| Command                      | What it does                      |
| ---------------------------- | --------------------------------- |
| `agnos hooks` / `hooks list` | Print the declared hooks.         |
| `agnos hooks add`            | Add a command hook interactively. |
| `agnos hooks remove <event>` | Remove all hooks for an event.    |

Changes to the registry are materialized on the next `agnos install`.

## License

MIT.
