---
type: Technical Doc
title: Stateless Generation Cutover
description: Manual migration steps for projects moving to whole-file rules generation and direct skill links.
resource: ""
tags: [migration, rules, skills, configuration]
timestamp: 2026-10-23T00:00:00Z
---

# Stateless Generation Cutover

## Configuration paths

Update `agnos.json` to use `.agnos/docs` for authored documentation, `.agnos/rules` for authored rule sources, `.agnos/skills` for manually authored skills, and `.agnos/references` for generated reference links. Configure each directory with its domain's `dir` field. Remove `skills.route`; skills now link separately into each configured harness directory.

Move authored files into the selected source directories before changing their configured paths. Keep those sources in version control. Do not ignore or delete `.agnos` as a whole.

## Rules output

Rules artifacts are fully regenerated from `rules.fragments` on a successful run. Before the first generation, move any authored content from an old canonical output into source Markdown files. Put the optional top-level H1 and shared introduction in `rules.dir/_index.md`; put remaining content into fragments. Only that root `_index.md` may contain an H1, at most one. Other selected files may use H2 and deeper headings, but must not contain H1.

Generated artifacts overwrite their prior bytes. Keep canonical output paths for generated files only. Remove obsolete outputs manually after changing the declarations.

## Skill and reference links

Remove an old agent-level directory symlink to a combined skill directory before Agnos renders per-skill links. Preserve any real directory and its files unless you have confirmed it contains only old generated output. Normal runs retain links for declarations removed manually; clean only obsolete links or generated output paths when needed.

Repository consumers are registered in the global tracker catalog. Explicit remove commands release the selected consumer. Editing declarations directly may leave stale project links or global registrations, which users remove manually.

`agnos.lock.json` retains its existing skill snapshot behavior. Agnos no longer reads or writes project `state.json`.
