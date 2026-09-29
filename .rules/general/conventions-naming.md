---
type: Rule
title: Naming Conventions...
description: Define shared reuse, module, and localization conventions.
resource: ""
tags: [conventions, naming]
timestamp: 2026-08-19T00:00:00Z
---

### ... for directories

Directories use `camelCase` unless explicitly told otherwise.

### ... for files

For files we use:

- `<domain>.<role>.<ext>`: A declarative, **dot-delimited** `cammelCase` file naming strategy with a predictable pattern that encodes the domain and the architectural role, for the pieces that compose a feature.
- `index`: for the barrel files.

Examples of roles:
| Role | Use for... |
| ------------------------------------------------ | -------------------------------------------------------- |
| module | bundling a feature |
| controller, component | orchestraiton and coordination |
| modal, dialog, drawer, presentation, form, etc.. | ui blocks like overlays, modals, drawers, popups, etc... |
| dto, entity, schema | data shapes, contracts, models, etc... |
| api, service | business logic |
| hook.<useHookName>, store, context, repository | data fetching, state, external apis, etc... |
| css stylesheet, css module | styling rules |
| utility, helper, command | pure funtions, commands, directives, parsers, etc... |
| i18n.<lang>, i18n.\_schema | internationalization |
| test, test.input, test.seed | tests and test files |

Never use `kebab-case`.

In the case the files in a directory grow too much due to expanding sub-roles, the roles can be moved to a directory within the domain that logacally represents what it contains, e.g.:

- `i18n` role has an additional part for language and schema. They can be moved to `i18n/`.
- `tests` role might grow to have too many files. They can be moved to `tests/`.
- multiple roles like `dialog`, `drawer`, and `modal` cover overlapping concerns. They can be moved to `components/`.

### ... for code

Whenever writting code, use:

- `UPPER_SNAKE_CASE` for constants.
- `PascalCase` for type declarations, classes, components, generics, and enums.
- `camelCase` for everything else.
