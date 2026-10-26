---
type: Technical Doc
title: Skills Sources and Agent Links
description: How Agnos combines local authored skills with globally tracked repository selections.
resource: ""
tags: [configuration, skills, repositories]
timestamp: 2026-10-23T00:00:00Z
---

# Skills Sources and Agent Links

## Source declarations

`agnos.json#skills.dir` selects manually authored skills and defaults to `.agnos/skills`. Each direct child directory containing `SKILL.md` is available to configured harnesses. These skills remain authored project content and bypass Git tracking, imports, and lock metadata.

`agnos.json#skills.sources` declares external skills as normalized repository requests. Every request selects one concrete skill directory. The global `RepositoryTracker` shares Git checkouts between projects and domains. An omitted commit follows a live branch; an explicit commit selects a fixed snapshot.

## Agent links

Each selected skill directory is linked individually into each active harness's native skills directory. The link includes supporting files. Local authored skills take precedence over external skills with the same name. Existing links update when a declared target changes, while unrelated real files and directories cause a conflict.

Normal runs retain links for removed declarations. Use the explicit skill removal command to release that skill's tracker consumer and remove its generated harness links. Users remove other stale links manually.

## Lock metadata and updates

`agnos.lock.json` retains the existing skill hash and observed commit fields. An observed commit is not a pin. Reproducibility requires an explicit commit in the source request. The skills update command advances unpinned global branch checkouts and refreshes lock observations. Every project linked to the same live checkout sees that update.

Local filesystem sources declared under `skills.sources` are imported into global content-hash storage. Skills under `skills.dir` are linked directly from the project.

## References

- Skills command: [index.ts](../../../src/domains/skills/index.ts).
- Skills steps: [steps.ts](../../../src/domains/skills/steps.ts).
- Shared storage: [Repository Tracking](repository-tracking.md).
