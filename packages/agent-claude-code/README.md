# @luxia/agent-claude-code

[![npm version](https://img.shields.io/npm/v/@luxia/agent-claude-code?color=18181B&label=npm&style=flat-square)](https://www.npmjs.com/package/@luxia/agent-claude-code)
[![license](https://img.shields.io/npm/l/@luxia/agent-claude-code?color=18181B&style=flat-square)](https://github.com/rgdevme/luxia/blob/main/LICENSE)

[agnos](https://github.com/rgdevme/luxia) strategy plugin for [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

## What it does

This plugin teaches agnos how to materialize project configuration into the files Claude Code reads:

| Domain | File written      | Behavior                                                                                                                                                                 |
| ------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| rules  | `CLAUDE.md`       | Symlinked to the rules source declared in `agnos.json#rules.source` (defaults to `./AGENTS.md`). Falls back to a copy on systems without symlink privileges.             |
| mcp    | `.mcp.json`       | Regenerated from `agnos.json#mcp` on every install. Supports `stdio`, `sse`, and `http` transports. Can also reverse-import an existing `.mcp.json` on first activation. |
| skills | `.claude/skills/` | Symlinked to `.agnos/skills/` (or whatever `paths.skillsDir` resolves to) so every current and future skill is picked up through a single directory-level link.          |

## Install

You usually get this for free with [`@luxia/agnos`](../agnos/README.md). To install it standalone in a project:

```sh
pnpm add -D @luxia/agent-claude-code
agnos agent add claude-code
```

## Activate

Once installed, list `"claude-code"` in `agnos.json#agents`:

```json
{
  "agents": ["claude-code"],
  "rules": { "source": "./AGENTS.md" },
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
CLAUDE.md -> ./AGENTS.md
.mcp.json (1 server)
.claude/skills -> .agnos/skills
```

## Removal

```sh
agnos agent remove claude-code
```

Strips `CLAUDE.md`, `.mcp.json`, and the `.claude/skills/` link. Skills under `.agnos/skills/` are preserved because they belong to the project, not to the agent.

## Importing an existing setup

If your project already has a `.mcp.json` from Claude Code, agnos imports it the first time you activate the plugin. The servers land in `agnos.json#mcp`, and from that point on they are managed centrally. Re-running `agnos install` regenerates `.mcp.json` from the central declaration.

## License

MIT.
