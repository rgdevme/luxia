---
type: Rule
title: Verification Policy
description: Verify changes proportionally and report evidence without hiding failures.
resource: ""
tags: [verification, quality, delivery]
timestamp: 2026-08-19T00:00:00Z
---

## Verification policy

- Verify every change in proportion to its risk and affected surface.
- Use the project-defined checks and the narrowest relevant validation first.
- Expand to broader checks when changes cross packages, contracts, build boundaries, or deployment behavior.
- Follow the [testing rules](testing.md) when verification requires creating or changing tests.
- Run existing relevant tests without requiring separate approval.
- Verify both successful behavior and expected failure behavior for critical paths.
- Include generated artifacts, configuration, documentation, and packaging checks when they are affected.

### Failure handling

- Do not weaken assertions, disable checks, or change expected output only to make verification pass.
- Distinguish failures caused by the change from pre-existing failures and unavailable external systems.
- Investigate unexpected failures before classifying them as unrelated.
- Report any required verification that could not run and explain why.

### Completion evidence

- Review the final diff after automated checks complete.
- Record the commands or workflows run and their outcomes.
- Report warnings separately from errors.
- Do not state that verification passed when checks were skipped, incomplete, or failing.
