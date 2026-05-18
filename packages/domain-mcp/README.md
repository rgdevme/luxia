# @luxia/domain-mcp

[![npm version](https://img.shields.io/npm/v/@luxia/domain-mcp?color=18181B&label=npm&style=flat-square)](https://www.npmjs.com/package/@luxia/domain-mcp)
[![license](https://img.shields.io/npm/l/@luxia/domain-mcp?color=18181B&style=flat-square)](https://github.com/rgdevme/luxia/blob/main/LICENSE)

[agnos](https://github.com/rgdevme/luxia) domain plugin that owns the **MCP servers** category. One declaration; every agent regenerates its own format.

## What it does

- Owns the `mcp` array in `agnos.json`.
- Validates declarations against a Zod schema.
- Runs an interactive `agnos mcp add` flow that asks for transport, command, args, and env.
- Hands each `ResolvedMcp` to every active agent's `handles.mcp.onInitialize`, which is responsible for rendering the right file format (`.mcp.json` for Claude Code, `.codex/config.toml` for Codex, and so on).

The domain itself owns no on-disk artifact. Agent plugins fully rewrite their MCP config on every install, which makes the operation idempotent and immune to drift.

## Install

You usually get this for free with [`@luxia/agnos`](../agnos/README.md). Standalone:

```sh
pnpm add -D @luxia/domain-mcp
```

## Configuration

```json
{
  "mcp": [
    {
      "name": "github",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" }
    },
    {
      "name": "linear",
      "transport": "http",
      "command": "https://mcp.linear.app/sse"
    }
  ]
}
```

Each entry:

- `name` (required) is the server id agents will see.
- `transport` is `"stdio"` (default), `"sse"`, or `"http"`.
- `command` is the executable for `stdio` or the URL for `sse`/`http`.
- `args` and `env` are passed through to `stdio` servers.

## CLI

| Command                   | What it does                                                                      |
| ------------------------- | --------------------------------------------------------------------------------- |
| `agnos mcp add <name>`    | Add a server interactively.                                                       |
| `agnos mcp update <name>` | Re-resolve a declared server.                                                     |
| `agnos mcp remove <name>` | Remove a server. Agents drop it from their generated configs on the next install. |

## License

MIT.
