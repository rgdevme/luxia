---
type: Technical Decision
title: Shared Repository Store and Direct Agent Links
description: Records why Agnos shares repository checkouts globally and links selected content directly into project agent directories.
resource: ""
tags: [skills, repositories, storage, caching]
timestamp: 2026-08-13T00:00:00Z
---

# Global Skill Store

## Decision

Agnos uses one versioned global store per user for bare repositories, branch and pinned worktrees, and verified externally sourced skill content. Repository consumers share the same live branch checkout when they select the same repository and branch. Explicit commit pins use separate immutable checkouts. Projects retain declarations in `agnos.json`; references link into shared repository worktrees, and selected skills link directly into each active harness's skills directory. Manually authored skills under `skills.dir` remain project content and take precedence over an external skill with the same name.

## Rationale

- Repository objects are cloned once and shared across branches, selections, projects, and domains.
- Identical locked skills are stored once across projects.
- A live branch update is visible to every consumer linked to that branch checkout.
- Hash verification makes shared reuse deterministic and detects accidental corruption.
- Removing one consumer cannot prune a checkout still used by another consumer.
- Exact commit fetches reproduce missing entries after a tracked branch advances.

## Consequences

- The global store is part of the current user's trust boundary.
- Shared live checkouts reflect accepted branch updates in every linked project.
- Projects that need reproducible repository content must declare an explicit commit pin.
- Machine-specific store placement remains outside project configuration.
- Project `state.json` is not needed; current declarations plus the global tracker catalog provide the information required for installation and updates.

## References

- Skill links: [Skills Sources and Agent Links](../technical/skills-reconciliation.md).
- Repository tracking: [Repository Tracking](../technical/repository-tracking.md).
