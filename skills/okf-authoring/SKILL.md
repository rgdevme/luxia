---
name: okf-authoring
description: Source-of-truth conventions for writing structured Markdown knowledge files for LLM and agent consumption using the Open Knowledge Format (OKF). Use whenever creating or editing OKF-style docs, agent rules, or other structured text bundles.
---

# OKF authoring

Use this skill whenever you create or edit structured Markdown files meant for
LLM or agent consumption, including documentation bundles and agent rule
fragments.

## Source of truth

Use the canonical OKF spec as the source of truth:

- [OKF SPEC.md](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
- Local fallback: [references/OKF-SPEC.md](references/OKF-SPEC.md)
- Refresh script: `node <path-to-this-skill>/refresh-reference.mjs`

When network access is available, refresh the local fallback before changing OKF
rules if it has not been checked in at least a week. If this skill conflicts
with the canonical spec, follow the canonical spec for OKF baseline behavior.

## Baseline conformance

Follow the OKF spec for baseline conformance:

- Every non-reserved `.md` file is a concept document.
- Every concept document must begin with parseable YAML frontmatter.
- Every concept document must include a non-empty `type` field.
- `index.md` and `log.md` are reserved filenames.
- Consumers must tolerate unknown frontmatter keys, unknown `type` values,
  broken cross-links, missing optional fields, and missing index files.

## Local policy

Project-specific skills may define stricter rules on top of OKF:

- Required optional frontmatter fields.
- Reserved directories or filenames.
- Heading structure.
- Writing conventions.
- Log or index maintenance.

Treat those stricter rules as local policy, not OKF baseline behavior.

## Agnos frontmatter policy

Agnos requires stricter frontmatter than the OKF baseline. Every concept
document must begin with YAML frontmatter carrying this shape:

```markdown
---
type: Concept kind
title: Short title
description: Short description.
resource: ""
tags: []
timestamp: 2026-06-30T00:00:00Z
---
```

Fields:

- `type`, `title`, `description`, and `timestamp` must be present and non-empty.
- `resource` and `tags` must be present but may be empty (`""` and `[]`).
- `timestamp` must use an ISO 8601 datetime.
- Update `timestamp` whenever changing a concept document.
- Producers may add custom fields; consumers must tolerate and ignore them.

## Writing conventions

- Do not use em dashes.
- Do not sign documentation or rules as yourself.
- Do not write token values, code snippets, or anything already stated in code,
  unless it is a reference.
- Do not duplicate values that live elsewhere. Reference the file path instead.

## Linking conventions

- All cross-references between files must use Markdown links:
  `[display text](relative/path.md)`.
- Bundle-relative absolute links begin with `/` and resolve from the bundle root.
- Relative links resolve from the current file.
- Do not use bare backtick-quoted paths for internal links.
- Backtick strings are acceptable only for references.

## Conventional body sections

Use these OKF headings when their content applies:

- `# Schema` for a structured description of an asset's columns or fields.
- `# Examples` for concrete usage examples.
- `# Citations` for external sources, numbered and linked.

## Shared validation

Before finishing, verify:

- Frontmatter is parseable YAML.
- Required Agnos frontmatter fields are present.
- Links use Markdown syntax.
- There are no em dashes.
- There is no signature or agent attribution.

## Freshness

Refresh the local fallback only when needed:

- Run `node <path-to-this-skill>/refresh-reference.mjs` if it has not run in at least a week.
- Run `node <path-to-this-skill>/refresh-reference.mjs --force` if the user requests a refresh.
- Review dependent skills if [references/OKF-SPEC.md](references/OKF-SPEC.md) changes.
