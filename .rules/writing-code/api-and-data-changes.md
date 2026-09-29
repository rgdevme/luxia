---
type: Rule
title: API and Data Changes
description: Evolve contracts and persisted data without silent breakage or corruption.
resource: ""
tags: [api, data, migrations]
timestamp: 2026-08-19T00:00:00Z
---

## API and data changes

- Treat public APIs, events, files, schemas, and persisted records as explicit contracts.
- Identify producers, consumers, ownership, and compatibility requirements before changing a contract.
- Validate external data at ingress and serialize responses through defined output contracts.
- Keep contract behavior consistent across runtime types, validation, documentation, and generated clients.
- Do not expose internal storage shapes as public contracts without an explicit decision.

### Compatibility

- Prefer additive changes when existing consumers must continue working.
- Do not remove, rename, reinterpret, or narrow fields without an approved migration or version boundary.
- Keep error shapes and status semantics stable unless the contract change explicitly includes them.
- Define deprecation and removal conditions for transitional behavior.
- Remove compatibility paths after their migration window closes.

### Data migrations

- Separate schema expansion, data migration, and schema contraction when an immediate cutover is unsafe.
- Make migrations restartable and safe to retry.
- Preserve data until successful migration and verification are confirmed.
- Define rollback or recovery behavior before destructive transformations.
- Use transactions or equivalent consistency controls for related writes.
- Protect concurrent updates from lost writes, duplicate effects, and partial state.
- Record progress for long-running migrations without storing sensitive data.
