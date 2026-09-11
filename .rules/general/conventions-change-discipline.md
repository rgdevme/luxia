---
type: Rule
title: "Change Discipline"
description: Keep changes intentional, scoped, reversible, and respectful of existing work.
resource: ""
tags: [changes, scope, collaboration]
timestamp: 2026-08-26T14:20:00Z
---

- Understand the requested outcome before changing files or external state.
- Inspect relevant or shared code, configuration, documentation, and established patterns first. Codebase is small; grep first.
- Limit changes to the requested outcome and its necessary supporting work.
- No abstractions for hypothetical needs. Build for what's asked; symmetry over flexibility when adding hooks (if there's onAdded, there's probably onRemoved).
- Preserve unrelated edits and user-owned work.
- Do not perform opportunistic refactors, migrations, or cleanup.
- Follow the existing architecture unless the task explicitly changes it.
- Identify generated files and update their source of truth instead of editing generated output directly.

### Decisions and risk

- State assumptions that materially affect behavior or scope.
- Ask for direction when unresolved ambiguity would produce meaningfully different outcomes.
- Resolve exact targets before destructive, irreversible, or externally visible actions.
- Preserve compatibility unless the task explicitly authorizes a breaking change.

### Completion

- Review the final diff for unrelated changes, accidental formatting, generated noise, and sensitive information.
- Report completed work, verification results, assumptions, and remaining limitations.
- Do not claim completion while required work or verification remains unfinished.
