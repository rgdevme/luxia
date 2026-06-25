<p align="center">
  <img src=".github/assets/banner.svg" alt="agnos" width="640" />
</p>

<p align="center">
  <strong>One config. Every coding agent.</strong>
  <br/>
  <sub>Project-level configuration for AI coding agents, materialized into whatever each tool expects to find on disk.</sub>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@luxia/agnos"><img alt="npm version" src="https://img.shields.io/npm/v/@luxia/agnos?color=18181B&label=npm&style=flat-square" /></a>
  <a href="https://nodejs.org"><img alt="node" src="https://img.shields.io/node/v/@luxia/agnos?color=18181B&style=flat-square" /></a>
  <img alt="esm only" src="https://img.shields.io/badge/esm-only-F59E0B?style=flat-square" />
  <img alt="typescript" src="https://img.shields.io/badge/typed-typescript-18181B?style=flat-square" />
</p>

---

## What is agnos?

**agnos is a project-level configuration manager for AI coding agents.** You declare your docs, rules, skills, MCP servers, and hooks once in a single `agnos.json` at the root of your repo. agnos materializes that declaration into whatever each agent expects: `CLAUDE.md` + `.mcp.json` + `.claude/settings.json` for Claude Code, `AGENTS.md` + `.codex/config.toml` for Codex, and so on.

agnos ships as a **single package** (`@luxia/agnos`) with a fixed, built-in set of agents (Claude Code, Codex) and domains (docs, rules, skills, mcp, hooks, agents).

## The model: config writers + one config reader

agnos splits its work in two:

- **Config-writer domains** manage their own slice of the project. `skills`/`mcp`/`hooks` write entries into `agnos.json`; `docs` compiles a documentation index; `rules` injects titled sections into your canonical rules file(s).
- **One config-reader domain — `agents`** — reads `agnos.json` and the canonical outputs and renders **every** per-agent native file via per-agent adapters. Installing an agent is just "render its files"; removing it is "delete its files."

```
        ┌──────────── config WRITERS ────────────┐      ┌── reader ──┐
 docs ──▶ .docs/index.md                                 │            │
 rules ─▶ ./AGENTS.md (titled sections injected) ───────▶│  agents    │──▶ CLAUDE.md, .mcp.json,
 skills ▶ agnos.json#skills + .agnos/skills/             │ (adapters) │    .claude/settings.json,
 mcp ───▶ agnos.json#mcp                                 │            │    .claude/skills, .codex/*
 hooks ─▶ agnos.json#hooks                               │            │
        └─────────────────────────────────────────┘      └────────────┘
```

## Quick start

```sh
npm i -g @luxia/agnos
cd my-project
agnos --init        # bootstrap agnos.json + pick agents (add -y for defaults)
agnos --once        # run the pipeline once: prepare skills → docs → rules → render agents
agnos               # watch mode: keep agent files in sync as sources change
```

A typical `agnos.json`:

```jsonc
{
  "$schema": "https://unpkg.com/@luxia/agnos/schema.json",
  "schemaVersion": 1,
  "agents": ["claude-code", "codex"],
  "docs": { "root": ".docs" },
  "rules": { "files": { "./AGENTS.md": ["./.docs/index.md", "./fragments/security.md"] } },
  "skills": { "sources": { "pdf": "github:vercel-labs/agent-skills/skills/pdf" } },
  "mcp": [
    {
      "name": "github",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" },
    },
  ],
  "hooks": [
    { "event": "PreToolUse", "matcher": "git", "type": "command", "command": "echo guard" },
  ],
}
```

## CLI

```
agnos [domain] [--dry] [--once] [--quiet] [--help] [--init [-y]]
```

- **`agnos`** — run all domains in watch mode.
- **`agnos <domain>`** — run one domain (`docs|rules|skills|mcp|hooks|agents`).
- **`agnos <domain> <sub>`** — domain subcommands (e.g. `agnos agents add`, `agnos skills migrate`).
- **`--once`** — single pass, no watchers. **`--dry`** — log planned actions, write nothing (implies `--once`). **`--quiet`** — errors only. **`--init [-y]`** — bootstrap.

## Domains

| Domain   | Owns                                  | Notes                                                                 |
| -------- | ------------------------------------- | --------------------------------------------------------------------- |
| `docs`   | `agnos.json#docs` → `.docs/index.md`  | Compiles a metadata index; surface it by listing it in `rules.files`. |
| `rules`  | canonical rules file(s)               | Injects titled sections (by frontmatter `title`) from fragment files. |
| `skills` | `agnos.json#skills` + `.agnos/skills` | Fetches + verifies skills; agents link the canonical dir.             |
| `mcp`    | `agnos.json#mcp`                      | MCP servers, rendered per agent.                                      |
| `hooks`  | `agnos.json#hooks`                    | Flat array of command hooks, regrouped per agent.                     |
| `agents` | per-agent native files                | The sole renderer; reads everything above.                            |

## Status

agnos is at **v0.1** — a ground-up redesign into a single package with the writer/reader model above. Pre-1.0: expect breaking changes on the road to 1.0.

## Contributing

Node 24+, ESM only, TypeScript throughout. Build/test:

```sh
pnpm install
pnpm build && pnpm typecheck && pnpm test && pnpm lint
```

Issues and PRs welcome at [github.com/rgdevme/luxia](https://github.com/rgdevme/luxia).

## License

MIT.
