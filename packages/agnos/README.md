# agnos

Agent-agnostic project configuration manager.

This is the umbrella package: it installs the `agnos` CLI plus the default
agent and domain plugins so the tool works out of the box.

## Install

Global (zero-config, useful anywhere — including non-Node projects):

```sh
npm i -g @luxia/agnos
```

Per-project (pins plugin versions and lets you swap defaults for forks):

```sh
cd my-project
agnos init
```

`agnos init` will offer to install the default plugins as `devDependencies`
of your project. If you accept, project-local plugins override the bundled
ones automatically.

## What's bundled

- `@luxia/core` — the CLI
- `@luxia/agent-claude-code`, `@luxia/agent-codex`
- `@luxia/domain-rules`, `@luxia/domain-mcp`, `@luxia/domain-skills`, `@luxia/domain-docs`
