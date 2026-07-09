---
title: Documentation Index
---

### plans

- [Implementation Plan — @luxia/agnos v0.1](plans/refactor-implementation-plan.md): Milestone-by-milestone sequencing plan for the v0.1 refactor, covering branch protocol, milestone dependency chain, and file-location mapping from the old monorepo to the new single-package layout.
- [PRD — @luxia/agnos v0.1](plans/prd.md): Product requirements document for collapsing the 8-package monorepo into a single `@luxia/agnos` package and redesigning the domain model around config writers and a single config reader (agents).

### technical

- [Config Matching](technical/config-matching.md): How agnos resolves glob-aware documentation ignores and rule fragments.
- [MCP Env Resolution](technical/mcp-env-resolution.md): How MCP env key declarations are resolved into secret-bearing agent files.
- [Skills Reconciliation](technical/skills-reconciliation.md): How declared skill sources are reconciled with materialized skills and lock entries.
