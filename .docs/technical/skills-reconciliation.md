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
- Skill reconciliation runs with bounded concurrency while preserving declaration order in its result.
- Concurrent requests for the same Git source are coalesced into one fetch.
- Git checkouts use an isolated per-run workspace under `.agnos/tmp/repos`.
- Repository workspaces are removed at the end of each command or domain run, including when skills are moved, changed, or fail to install.

## Content-addressed storage

- Skill content is stored once per user in a global, versioned store selected from the operating system data directory.
- `AGNOS_STORE_DIR` overrides the global store base for installations that need a custom location.
- Every store reuse recomputes the skill hash. Invalid entries are replaced through atomic publication.
- The configured skills route contains an independent project materialization imported with copy-on-write cloning, hard links, or copies.
- Project materializations remain usable if the global store is removed.
- A pinned remote skill can be restored from its lock entry and global stored content without a Git operation.
- Local skill sources are still hashed on each reconciliation so local edits are detected.
- `agnos skills integrity` explicitly hashes project materializations instead of trusting tool-managed state.
- Updates bypass any checkout already staged during the current run before computing and accepting a new hash.
- Store publication never deletes the final hash path, tolerates concurrent publishers, and retries transient Windows filesystem errors.
- Lock updates use temporary files and atomic publication so concurrent readers never observe partial JSON.

## Reproducible fetches

- New remote lock entries record the commit SHA returned by the checkout that supplied the accepted content.
- A missing global entry is refetched at the locked commit rather than the current branch head.
- Legacy lock entries without a commit fetch their tracked ref once and are backfilled only when the content hash still matches.

## Legacy migration

- Referenced entries from `.agnos/cache/skills` are verified and promoted into the global store.
- Existing project links are replaced with independent materializations before the legacy cache is removed.
- A failed or incomplete migration retains the project cache and reports a warning.

## Progress reporting

- Interactive installs show a live completion percentage.
- The progress line reports the declared skill total, content-store reuses, and source fetches.
- A content-store hit increments `reused`. A skill loaded successfully from its declared source increments `fetched`.
- Quiet and non-interactive runs omit the transient progress line.
- Successful interactive and non-interactive installs emit a final 100 percent summary with the same counters.

## References

- Skills command surface: [index.ts](../../src/domains/skills/index.ts).
- Skills steps: [steps.ts](../../src/domains/skills/steps.ts).
- Skills pipeline tests: [skills-pipeline.test.ts](../../test/domains/skills-pipeline.test.ts).
- Global store decision: [Global Skill Store](../technical-decisions/global-skill-store.md).
