# @luxia/domain-docs

[![npm version](https://img.shields.io/npm/v/@luxia/domain-docs?color=18181B&label=npm&style=flat-square)](https://www.npmjs.com/package/@luxia/domain-docs)
[![license](https://img.shields.io/npm/l/@luxia/domain-docs?color=18181B&style=flat-square)](https://github.com/rgdevme/luxia/blob/main/LICENSE)

[agnos](https://github.com/rgdevme/luxia) domain plugin that owns the **docs** category: a structured documentation route with an auto-generated index and frontmatter rules that agents can read before they write.

## What it does

- Owns the `docs` block in `agnos.json`.
- Scaffolds a documentation route (default `.docs/`) with an `index.md`, optional `content.md`, and a `doc-rules.md` file.
- Defines a frontmatter metadata schema that every doc must satisfy. The default schema includes `title`, `description`, `read_when`, and `agent_cant`.
- Generates and validates docs from the CLI.
- Injects the docs index and rules into the project rules file (typically `AGENTS.md`) so every agent's first read includes it.
- Watches the docs route for changes and re-injects on save.

## Why a docs domain?

Most agents discover and use project docs through whatever lives in `AGENTS.md`. This domain gives that file a real index and a real ruleset, so an agent reading the rules file gets a structured map of what docs exist, when to read each one, and what it must not do with them.

## Install

You usually get this for free with [`@luxia/agnos`](../agnos/README.md). Standalone:

```sh
pnpm add -D @luxia/domain-docs
```

## Configuration

```json
{
  "docs": {
    "route": ".docs",
    "indexName": "index",
    "contentName": "content",
    "docRulesName": "doc-rules",
    "injectIndex": true,
    "injectRules": true
  }
}
```

All fields are optional. The defaults shown above are applied when missing.

You can also customize the metadata schema:

```json
{
  "docs": {
    "metadata": {
      "title": "Short, human-readable title.",
      "owner": "GitHub handle of the person responsible.",
      "agent_cant": "What the agent must not do with this file: read, write, delete, or a combination."
    }
  }
}
```

## CLI

| Command                      | What it does                                                   |
| ---------------------------- | -------------------------------------------------------------- |
| `agnos docs init`            | Scaffold the docs route. Idempotent.                           |
| `agnos docs generate`        | Generate `index.md` from the docs that live under `route/`.    |
| `agnos docs validate`        | Check that every doc satisfies the metadata schema.            |
| `agnos docs inject`          | Inject the index and rules blocks into the project rules file. |
| `agnos docs watch` (default) | Watch the docs route and re-inject on change.                  |

## License

MIT.
