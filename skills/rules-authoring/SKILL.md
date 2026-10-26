---
name: rules-authoring
description: Conventions for writing rules for agents with agnos. Requires okf-authoring. Use whenever creating or editing rules files for agents.
---

# Rules authoring

Follow these conventions whenever you create or edit rules files under the
project's rules directory declared in [`agnos.json#rules.dir`](/agnos.json#rules.dir).

## Mandatory

- Read and follow the `okf-authoring` skill before applying this skill. Do not by-pass it.
- Treat this skill as rules-specific policy layered on top of `okf-authoring`.
- Files produced with this skill must have its `type` set to `Rule`.

## File structure

- Agnos generates each configured rules artifact from the selected source files.
- The optional `rules.dir/_index.md` is included first unless it is explicitly listed elsewhere.
- Only `rules.dir/_index.md` may contain an H1 heading, and it may contain at most one.
- Every other selected file must not contain an H1. Use any lower heading level, including H2.
- YAML frontmatter is removed before source bodies are joined. Frontmatter titles do not become headings.
- Edit source files under `rules.dir`; generated output files are overwritten on the next run.

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
<okf-frontmatter-metadata>
---

<Breif instruction on when to use these rules>
- <Top-level rule>
- ...

### <Section title>

- <Section rule>
- ...
```

## Validation

Before finishing, verify:

- Shared validation from `okf-authoring` passes.
- Only the rules-root `_index.md` may have an H1, and only once.
- Other files contain no H1, including nested files named `_index.md`.
- The block title is clear and user-facing.
- The content is concise.
