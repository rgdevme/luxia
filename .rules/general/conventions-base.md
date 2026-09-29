---
type: Rule
title: Conventions
description: Define shared reuse, module, and localization conventions.
resource: ""
tags: [conventions, modularity]
timestamp: 2026-08-19T00:00:00Z
---

- Idempotency is mandatory for anything that touches the filesystem.
- If a pattern appears twice, extract it.
- Use barrel exports and keep them updated.
- Organize logic by functionality and concern.
- One concept per file.
