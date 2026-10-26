---
type: Technical Doc
title: Rules Bootstrap and Generation
description: How Agnos acquires rule catalogs and generates complete rules artifacts from authored Markdown sources.
resource: ""
tags: [configuration, rules, bootstrap]
timestamp: 2026-10-23T00:00:00Z
---

# Rules Bootstrap and Generation

## Configuration

`agnos.json#rules.dir` selects the authored source directory and defaults to `.agnos/rules`. `agnos.json#rules.fragments` maps each generated artifact path to ordered source files, directories, or glob patterns. Paths are relative to `rules.dir`.

The rules domain regenerates each whole artifact from its selected sources. It strips YAML frontmatter, joins Markdown bodies with a blank line, and writes one trailing newline. Existing output content is never merged into the result. Editing a source replaces the generated artifact on the next run.

The optional rules-root `_index.md` is included first unless it is explicitly listed, in which case its configured position is preserved. It may contain zero or one H1 heading. Every other selected file must contain no H1, including nested files named `_index.md`. Heading validation ignores fenced code blocks and recognizes Setext headings.

If validation or source reading fails, Agnos preserves that artifact's existing bytes and reports the failure. Independent artifacts continue generating. Users clean obsolete outputs manually after changing declarations.

## Catalog discovery and copying

`agnos rules bootstrap` acquires a local or Git catalog through [Repository Tracking](repository-tracking.md), discovers Markdown files recursively, and preserves catalog-relative paths when copying selections into `rules.dir`. Bootstrap releases its temporary repository consumer when copying finishes. It writes authored sources and does not create generated canonical output directly.

## References

- Rules command: [bootstrap.ts](../../../src/domains/rules/bootstrap.ts).
- Rules generator: [generate.ts](../../../src/domains/rules/generate.ts).
- Rules configuration: [public.ts](../../../src/core/types/public.ts).
