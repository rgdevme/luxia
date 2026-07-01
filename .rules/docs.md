---
title: Managing Documentation
---

### Regenerating the docs index

- Use `pnpm exec agnos` to update all files, or `pnpm exec agnos docs` to update only the documentation index.

### Reading and searching

- Use the index file located at [agnos.json#docs.root](/agnos.json#docs.root) to find docs by topic.

### Writing conventions

- Strictly adhere to the [OKF spec drafted by Google](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
- Do **not** use em dashes.
- Do **not** sign documentation as yourself.
- Do **not** write token values, code snippets, or anything already stated in code, unless it's a reference.
- Do **not** duplicate token values in `.docs/` files. Reference the file path instead.

### Linking convention

- All cross-references between files must use **Markdown links**: `[display text](relative/path.md)`.
- Do **not** use bare backtick-quoted paths (e.g. ``[`file.md`](relative/path.md)``) for internal links. Backtick strings are acceptable only for references.

### Documenting conventions

- If a task **changes how a system works** (auth flow, data model, API pattern, subscription logic, etc.), update the relevant file in `.docs/technical/`.
- If a task introduces an **architectural decision** (introducing a **new pattern, library, or architectural approach**) document it in `.docs/technical-decisions`
- Do **not** update business, product, or design docs automatically. Surface gaps and let the user decide.
- If a task implies an undocumented decision in any of these areas, flag it at the end of your response:
  > ⚠️ **Doc gap detected:** [Decision summary]. Consider updating `.docs/[section]/[file].md`.
