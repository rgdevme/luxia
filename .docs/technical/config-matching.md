---
type: Technical Doc
title: Config Matching
description: How agnos resolves glob-aware documentation ignores and rule fragments.
resource: ""
tags: [configuration, docs, rules]
timestamp: 2026-07-08T00:00:00Z
---

# Config Matching

## Documentation ignores

- `docs.ignore` accepts glob patterns relative to `docs.root`.
- Ignored files are excluded from documentation index generation.
- Ignored directories exclude their nested Markdown files.
- Generated `index.md` and reserved `log.md` remain excluded from index generation.

## Rule fragments

- `rules.files` fragment entries may resolve to files, directories, or glob patterns.
- Literal files preserve existing single-fragment behavior.
- Directory entries expand to Markdown files recursively.
- Glob entries may match files or directories.
- Matched directories expand to Markdown files recursively.
- Final fragment order follows declaration order first, then alphabetical path order within each declaration.

## References

- Config schema: [schema.json](../../schema.json).
- Docs compiler: [compile.ts](../../src/domains/docs/compile.ts).
- Rules injector: [index.ts](../../src/domains/rules/index.ts).
