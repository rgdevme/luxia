## Coding Standards

Enforced on all packages. Non-negotiable.

- Package manager: `pnpm` only. Never use `npm` or `yarn`.

### Language & module system

- ESM only. Node ≥ 24.
- Import paths use .js extension even when importing .ts (NodeNext resolution).
- import type for types, import for runtime values. Always.
- No default exports except plugin entries.
- No top-level await. No CJS.

### TypeScript

- End-to-end.
- No `any` without justification.
- Strict mode + noUncheckedIndexedAccess + verbatimModuleSyntax.
- Async/await throughout: no callbacks, no .then() chains.
- Arrow functions for inline callbacks; named function declarations for module-level exports.
- Linting & Formatting: ESLint + Prettier via shared configs. Code must be clean before committing.

### Naming

- camelCase variables/functions, PascalCase types, UPPER_SNAKE constants.
- run* for command entry points. on* for lifecycle hooks. dispatch* for event fan-out. build* for constructors. ensure* for idempotent setup. resolve* for lookups.
- Plural names for collections (agents, not agentList).

### Comments

- Self-documenting code: Prefer clear naming over comments.
- Default: no comments. Self-documenting code first. Never restate what the code does.
- JSDoc only on public API surfaces (exported types, plugin contracts). Internal helpers don't get JSDoc.
- Comments explain why, never what. Rename a variable instead of describing what code does.
- // TODO: and // FIXME: reserved for tracked issues, not casual notes.

### Errors

- Throw Error with descriptive messages, preserving causes via { cause: originalErr }.
- Catch only when you can do something useful. Empty try/catch reserved for genuinely optional cleanup (e.g., unlink of a maybe-missing file).
- Return { ok: boolean } from orchestrator-level functions; don't throw across the CLI boundary.

### Logging

- Five levels: info, success, warn, error, debug. Use the level that matches the meaning.
- No manual ANSI codes: The logger handles color and TTY detection.
- Hook implementations log without manual indentation prefixes; the orchestrator wraps the logger.
- would: <action> prefix for dry-run output.

### File organization

- One concept per file.
- Public surface via src/index.ts re-exports.
- Shared types in src/types/public.ts.
- CLI commands under src/commands/<verb>.ts.
- Tests in packages/<name>/test/<concept>.test.ts.

### Testing

- One concept per test file.
- Real filesystem for end-to-end tests; mkdtemp + afterEach cleanup.
- Stub ResolveContext for unit tests; spy plugins for sequence assertions.
- Don't test private helper:. Go through the public API.
- Testing: Core and critical functionality must be tested.
- CI/CD gate: All code must pass `lint → typecheck → test → build` before being considered done.

### Commits

- Conventional multi-line messages: subject < 70 chars in imperative mood; body explains why.
- Group related changes; split unrelated work.
- Never amend pushed commits without explicit approval. Never --no-verify.

### Principles

- Idempotency is mandatory for anything that touches the filesystem. Every hook must be safe to re-run.
- Single source of truth `agnos.json` is user-edited; `.agnos/state.json` is tool-managed. Never split declared state across files.
- No abstractions for hypothetical needs. Build for what's asked; symmetry over flexibility when adding hooks (if there's onAdded, there's probably onRemoved).
- No backward-compat shims when redesigning: Clean cutover, migrate built-ins in the same change.
- Read existing patterns before inventing one. Codebase is small; grep first.
- No duplication: Before writing new logic, check `packages/shared`. Shared logic, types, and configs live there.
