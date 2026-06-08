# @luxia/agent-codex

[![npm version](https://img.shields.io/npm/v/@luxia/agent-codex?color=18181B&label=npm&style=flat-square)](https://www.npmjs.com/package/@luxia/agent-codex)
[![license](https://img.shields.io/npm/l/@luxia/agent-codex?color=18181B&style=flat-square)](https://github.com/rgdevme/luxia/blob/main/LICENSE)

[agnos](https://github.com/rgdevme/luxia) strategy plugin for [OpenAI Codex](https://github.com/openai/codex).

## What it does

This plugin teaches agnos how to materialize project configuration into the files Codex reads:

| Domain | File written         | Behavior                                                                                                                                                                                                                                                                |
| ------ | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| rules  | `AGENTS.md`          | Codex reads `AGENTS.md` natively. When `agnos.json#rules.root` is `.`, every canonical file is already in place and no link is created; when the canonical tree lives elsewhere (e.g. `./docs`), an `AGENTS.md` mirror is symlinked next to each materialized location. |
| mcp    | `.codex/config.toml` | Regenerated as TOML from `agnos.json#mcp` on every install. Supports `stdio`, `sse`, and `http` transports. Can reverse-import an existing `.codex/config.toml` on first activation.                                                                                    |
| skills | `.agents/skills/`    | Symlinked to `.agnos/skills/` so Codex picks up every current and future skill through a single directory-level link.                                                                                                                                                   |

## Install

You usually get this for free with [`@luxia/agnos`](../agnos/README.md). To install it standalone in a project:

```sh
pnpm add -D @luxia/agent-codex
agnos agent add codex
```

## Activate

Once installed, list `"codex"` in `agnos.json#agents`:

```json
{
  "agents": ["codex"],
  "rules": { "filename": "AGENTS.md", "root": ".", "dirs": [] },
  "mcp": [
    {
      "name": "github",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"]
    }
  ]
}
```

Then run `agnos install`. You will see:

```
AGENTS.md (in place)
.codex/config.toml (1 server)
.agents/skills -> .agnos/skills
```

## Removal

```sh
agnos agent remove codex
```

Removes the `.codex/` directory entirely and unlinks the `.agents/skills/` directory. If `AGENTS.md` is a symlink owned by this plugin, it is unlinked too; if it is the canonical rules source, it is left alone. Skills under `.agnos/skills/` are preserved.

## Importing an existing setup

If your project already has a `.codex/config.toml`, agnos imports the `[mcp_servers]` table the first time you activate the plugin. From that point on, `agnos.json#mcp` is the source of truth and `.codex/config.toml` is regenerated on every install.

## License

MIT.
