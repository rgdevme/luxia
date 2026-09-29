---
type: Rule
title: Coding Standards
description: Repository-wide language, package, quality, and implementation standards.
resource: ""
tags:
  - coding
  - typescript
timestamp: 2026-08-19T00:00:00Z
---

Enforced repo-wide. Non-negotiable.

### Package manager

**Use `pnpm` only.**

Never use other package managers, like `npm`, `yarn`, or `bun`.

### Turborepo

- **TurboRepo with remote caching**: Use remote caching to ensure fast build and deploy times.
  - subcommands like `<command>:<sub>` should write to the same cache as the parent `<command>`

### TypeScript

- End-to-end.
- No `any` without justification.
- Strict mode + noUncheckedIndexedAccess + verbatimModuleSyntax.
- Always use `type`. Avoid `interface` unless necessary.
- Always use `async/await` and `try/catch`. Avoid `.then()` chains.
- Always use named exports. Avoid default exports unless necessary.
- Always use arrow functions. Avoid named functions unless necessary or when explicitly told to use them.
- Always declare function components, never class components.
- Use aliases (`@`) to keep the import paths clean.
- Prefer single-line syntax for brief statements, functions, and control structures. Avoid unnecessary curly braces and line breaks. Examples:

  ```ts
  // dont's
  const double = (x: number): number => {
    return x * 2;
  };

  if (!user) {
    return null;
  }

  const age = 30;
  const user = {
    name: name,
    age: age,
  };

  type Status = "idle" | "loading" | "success";

  interface Point {
    x: number;
    y: number;
  }

  let label: string;

  if (isAdmin) {
    label = "Admin";
  } else {
    label = "User";
  }

  // prefer
  const double = (x: number): number => x * 2;

  if (!user) return null;

  const user = { name, age };

  type Status = "idle" | "loading" | "success";

  type Point = { x: number; y: number };

  const label = isAdmin ? "Admin" : "User";
  ```

### Comments

- Write self-documenting code.
- Use JSDoc when appropriate.
- Prefer clear naming over comments.
- Comments are used to explain why, never what.
- Only comment what can not be inferred from code.
- Do not use comments for documentation. Use the documentation for this.
- Do not leave `TODO` or `FIXME` comments unresolved in committed code.
- Do not duplicate information already in the documentation.

### Errors

- Throw Error with descriptive messages, preserving causes via { cause: originalErr }.
- Catch only when you can do something useful. Empty try/catch reserved for genuinely optional cleanup (e.g., unlink of a maybe-missing file).
- Return { ok: boolean } from orchestrator-level functions; don't throw across the CLI boundary.

### Logging

- Five levels: info, success, warn, error, debug. Use the level that matches the meaning.
- No manual ANSI codes: The logger handles color and TTY detection.
- Hook implementations log without manual indentation prefixes; the orchestrator wraps the logger.
- would: <action> prefix for dry-run output.

### Code health

- Use ESLint, Prettier, and `tsc` to validate code.
- Execute linting, formatting, type checking and testing before committing. Always.
