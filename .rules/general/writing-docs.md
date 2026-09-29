---
type: Rule
title: Managing and Authoring Documentation and Rules
description: Define when and how project documentation and rule fragments are maintained.
resource: ""
tags: [documentation, rules, authoring]
timestamp: 2026-08-19T00:00:00Z
---

Follow these rules whenever writing documentation or rules.

### Authoring conditions

- Author rules files when:
  - The user asks for a specific pattern to be implemented. For example: "use arrow functions", "names must be camelCased".
  - An audit reveals a pattern that can benefit the codebase.

- Author documentation when a task:
  - **changes how a system works**: auth flow, data model, API pattern, subscription logic, etc.
  - introduces an **architectural decision**: introducing a **new pattern, library, or architectural approach**.

### Authoring rules

When authoring documentation and rules:

- Always review your skills to author docs and rules correctly.
- Never author docs or rules without explicit approval from the user.
- Use simple and professional language.
- Do not add information that's not needed.
- Update only what's necessary. **Never** edit information that doesn't need to be updated.
- Remove duplicate, redundant, or stale information.
- Any authoring proposal must be flagged.

### Refreshing files with Agnos

If the project has an `agnos.json` file at the root, you may use any of the following commands as needed:

- `npx @luxia/agnos@latest docs --once` regenerate the docs.
- `npx @luxia/agnos@latest rules --once` regenerate the rules.
- `npx @luxia/agnos@latest --once` to regenerate both.

If using a package manager other than npm, use the correct equivalent to `npx`.
