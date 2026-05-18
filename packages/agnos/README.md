# @luxia/agnos

[![npm version](https://img.shields.io/npm/v/@luxia/agnos?color=18181B&label=npm&style=flat-square)](https://www.npmjs.com/package/@luxia/agnos)
[![npm downloads](https://img.shields.io/npm/dm/@luxia/agnos?color=18181B&style=flat-square)](https://www.npmjs.com/package/@luxia/agnos)
[![node](https://img.shields.io/node/v/@luxia/agnos?color=18181B&style=flat-square)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/@luxia/agnos?color=18181B&style=flat-square)](https://github.com/rgdevme/luxia/blob/main/LICENSE)

The umbrella package for [agnos](https://github.com/rgdevme/luxia). Installs the `agnos` CLI plus the default agent and domain plugins so the tool works out of the box.

## What is agnos?

One project-level config (`agnos.json`) materialized into whatever each AI coding agent expects to find on disk. See the [project README](https://github.com/rgdevme/luxia#readme) for the full pitch and architecture.

## Install

**Global** (zero-config, useful anywhere including non-Node projects):

```sh
npm i -g @luxia/agnos
```

**Per-project** (pins plugin versions and lets you swap defaults for forks):

```sh
cd my-project
agnos init
```

`agnos init` offers to install the default plugins as `devDependencies` of your project. If you accept, project-local plugins override the bundled ones automatically.

## What's bundled

| Package                                                      | Role                                                     |
| ------------------------------------------------------------ | -------------------------------------------------------- |
| [`@luxia/core`](../core/README.md)                           | The CLI binary, the plugin loader, and the orchestrator. |
| [`@luxia/agent-claude-code`](../agent-claude-code/README.md) | Strategy plugin for Claude Code.                         |
| [`@luxia/agent-codex`](../agent-codex/README.md)             | Strategy plugin for OpenAI Codex.                        |
| [`@luxia/domain-rules`](../domain-rules/README.md)           | Rules domain (project instructions file).                |
| [`@luxia/domain-mcp`](../domain-mcp/README.md)               | MCP servers domain.                                      |
| [`@luxia/domain-skills`](../domain-skills/README.md)         | Skills domain.                                           |
| [`@luxia/domain-docs`](../domain-docs/README.md)             | Project documentation domain.                            |

## Common commands

```sh
agnos init                     # set rules path + pick agents
agnos agents                   # pick which agent plugins are active
agnos agent add <id|pkg>       # install and activate an agent
agnos agent remove <id>        # deactivate and clean up
agnos skill add <source>       # pull a skill from git or local
agnos mcp add <name>           # add an MCP server interactively
agnos install                  # re-materialize current config
agnos --help                   # full reference
```

## License

MIT.
