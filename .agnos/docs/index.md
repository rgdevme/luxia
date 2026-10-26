---
title: Documentation Index
---

### plans

- [Implementation Plan — @luxia/agnos v0.1](plans/refactor-implementation-plan.md): Milestone-by-milestone sequencing plan for the v0.1 refactor, covering branch protocol, milestone dependency chain, and file-location mapping from the old monorepo to the new single-package layout.
- [PRD — @luxia/agnos v0.1](plans/prd.md): Product requirements document for collapsing the 8-package monorepo into a single `@luxia/agnos` package and redesigning the domain model around config writers and a single config reader (agents).

### technical

- [Config Matching](technical/config-matching.md): How Agnos resolves documentation ignores and generated rules sources.
- [Harness Skill Metadata Validation](technical/harness-skill-validation.md): How Agnos checks skill metadata for configured harnesses and reports advisory findings.
- [MCP Env Resolution](technical/mcp-env-resolution.md): How MCP env key declarations are resolved into secret-bearing agent files.
- [Repository References](technical/references.md): How project declarations link selected directories from shared global repository checkouts.
- [Repository Tracking](technical/repository-tracking.md): How Agnos stores repository checkouts globally and shares them between project consumers.
- [Rules Bootstrap and Generation](technical/rules-bootstrap.md): How Agnos acquires rule catalogs and generates complete rules artifacts from authored Markdown sources.
- [Skills Sources and Agent Links](technical/skills-reconciliation.md): How Agnos combines local authored skills with globally tracked repository selections.
- [Stateless Generation Cutover](technical/stateless-cutover.md): Manual migration steps for projects moving to whole-file rules generation and direct skill links.

### technical-decisions

- [Repository Configuration and Harness Boundaries](technical-decisions/harness-boundaries.md): Defines Agnos ownership for repository content, harness translation, and harness-specific runtime configuration.
- [Shared Repository Store and Direct Agent Links](technical-decisions/global-skill-store.md): Records why Agnos shares repository checkouts globally and links selected content directly into project agent directories.
