---
type: Technical Decision
title: Global Skill Store
description: Records why Agnos shares verified skill content globally while keeping project materializations independent.
resource: ""
tags: [skills, storage, caching]
timestamp: 2026-08-13T00:00:00Z
---

# Global Skill Store

## Decision

Agnos uses one versioned content-addressed skill store per user. Projects import independent materializations from that store and use their lockfiles to select exact content hashes and commits.

## Rationale

- Identical locked skills are downloaded and stored once across repositories.
- Hash verification makes shared reuse deterministic and detects accidental corruption.
- Independent project materializations continue working after the store is removed or pruned.
- Exact commit fetches reproduce missing entries after a tracked branch advances.

## Consequences

- The global store is part of the current user's trust boundary.
- Cross-project offline reuse requires a committed lockfile.
- Project materialization consumes filesystem metadata and may consume full file data when cloning and hard links are unavailable.
- Machine-specific store placement remains outside project configuration.

## References

- Reconciliation behavior: [Skills Reconciliation](../technical/skills-reconciliation.md).
