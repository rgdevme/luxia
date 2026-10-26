---
type: Technical Doc
title: Config Matching
description: How Agnos resolves documentation ignores and generated rules sources.
resource: ""
tags: [configuration, docs, rules]
timestamp: 2026-07-08T00:00:00Z
---

# Config Matching

## Documentation ignores

- `docs.ignore` accepts glob patterns relative to `docs.dir`.
- Ignored files are excluded from documentation index generation.
- Ignored directories exclude their nested Markdown files.
- Generated `index.md` and reserved `log.md` remain excluded from index generation.

## Generated rules sources

- Source paths resolve relative to `rules.dir`, which defaults to `.agnos/rules`.
- `rules.fragments` entries may select files, directories, or glob patterns.
- Literal files preserve declaration order.
- Directory entries expand to Markdown files recursively.
- Glob entries may match files or directories.
- Matched directories expand to Markdown files recursively.
- Sources follow declaration order first, then alphabetical path order within each directory or glob match.
- Generated artifacts contain source Markdown bodies joined in order. The optional root `_index.md` is first unless explicitly placed in the declaration.

## References

- Config schema: [schema.json](../../../schema.json).
- Docs compiler: [compile.ts](../../../src/domains/docs/compile.ts).
- Rules generator: [generate.ts](../../../src/domains/rules/generate.ts).
