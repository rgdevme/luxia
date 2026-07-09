---
type: Technical Doc
title: Skills Reconciliation
description: How declared skill sources are reconciled with materialized skills and lock entries.
resource: ""
tags: [configuration, skills, materialization]
timestamp: 2026-07-09T00:00:00Z
---

# Skills Reconciliation

## Source of truth

- `agnos.json` declares skills under `skills.sources`.
- The configured skills route is a materialized output of those declarations.
- `agnos.lock.json` stores pinned source metadata for declared skill sources.

## Pruning

- `agnos skills prune` removes materialized skill directories that are no longer declared.
- Pruning removes only direct children of the skills route that contain `SKILL.md`.
- Pruning drops lock entries whose source ref is no longer declared.
- Dry runs report prune actions without changing files or the lock.

## Install flow

- The skills domain prunes before installing or updating skills.
- A normal `agnos` run prunes before materializing declared skills.
- If no skills are declared, pruning still runs so stale materialized skills can be removed.

## References

- Skills command surface: [index.ts](../../src/domains/skills/index.ts).
- Skills steps: [steps.ts](../../src/domains/skills/steps.ts).
- Skills pipeline tests: [skills-pipeline.test.ts](../../test/domains/skills-pipeline.test.ts).
