---
name: rules-authoring
description: Conventions for writing rules for agents with agnos. Requires okf-authoring. Use whenever creating or editing rules files for agents.
---

# Rules authoring

Follow these conventions whenever you create or edit rules files under the
project's rules fragments root declared in [`agnos.json#rules.fragments`](/agnos.json#rules.fragments).

## Mandatory

- Read and follow the `okf-authoring` skill before applying this skill. Do not by-pass it.
- Treat this skill as rules-specific policy layered on top of `okf-authoring`.
- Files produced with this skill must have its `type` set to `Rule`

## File structure

- Each file must contain exactly one second-level heading: `## <Block title>`.
- Do not use first-level headings.
- Use `###`, `####`, and deeper headings only for nested sections.
- Do not add a second `##` heading in the same file.

## Content style

- Prefer directive bullets over paragraphs.
- Use short imperative sentences.
- Use `must`, `must not`, `use`, `do not`, and `prefer` consistently.
- Avoid vague guidance such as "be careful", "when appropriate", or "as needed".
- Do not invent terms when plain words work.

## Markdown syntax

- Prefer lists, tables, code blocks, quotes, callouts, bold, italic, links, and inline code over prose.
- Use code blocks only for examples or exact templates.
- Use tables only when comparing multiple items.

### Output template

```markdown
---
type: Rule
title: Short title
description: Short description
resource: ""
tags: []
timestamp: 2026-06-30T00:00:00Z
---

## <Block title>

- <Top-level rule>
- ...

### <Section title>

- <Section rule>
- ...
```

## Validation

Before finishing, verify:

- Shared validation from `okf-authoring` passes.
- The file has exactly one `##` heading.
- All nested headings are `###` or deeper.
- The block title is clear and user-facing.
- The content is concise.
