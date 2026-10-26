---
type: Technical Doc
title: Harness Skill Metadata Validation
description: How Agnos checks skill metadata for configured harnesses and reports advisory findings.
resource: ""
tags: [skills, harnesses, validation, compatibility]
timestamp: 2026-10-25T00:00:00Z
---

# Harness Skill Metadata Validation

## Ownership

The skills domain resolves the skill directory and parses its `SKILL.md` frontmatter. Each harness adapter validates the parsed metadata against that harness's documented requirements. Core does not keep a combined schema of harness-specific fields.

Validation findings include a stable code, harness id, skill name, file, optional field, and message. Every finding is advisory. Installation, updates, linking, and harness enablement continue when metadata is missing, invalid, or unsupported.

## When validation runs

`agnos skills add`, `agnos skills install`, and `agnos skills update` validate acquired skill content against the configured harnesses. `agnos harness add` and initialization validate locally available skills for the selected harnesses. Harness materialization validates each resolved skill before linking it.

`agnos skills check` inspects content already present in local skill directories or harness skill links. It does not fetch sources, update repositories, create links, or write lock observations. Use `--skills` and `--harness` to limit the check. An explicit harness can be checked before it is enabled.

Findings are logged and are not persisted in `agnos.json` or `agnos.lock.json`. Agnos preserves the source frontmatter and files without rewriting or translating them.

## Limits

Metadata checks establish only whether a harness can discover and interpret declared skill metadata. They do not execute skill scripts or guarantee that runtime tools, dependencies, or instructions work as intended.
