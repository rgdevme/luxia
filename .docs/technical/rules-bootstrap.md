---
type: Technical Doc
title: Rules Bootstrap
description: How rule catalogs are discovered and copied into a configured project.
resource: ""
tags: [configuration, rules, bootstrap]
timestamp: 2026-08-18T00:00:00Z
---

# Rules Bootstrap

## Configuration

- `agnos.json` declares the bootstrap destination under `rules.dir`.
- Injectable paths are resolved from `rules.dir` when configured and from the project root otherwise.
- Rules initialization configures the directory, adds `.` to the selected canonical rules file, and references the docs index relative to that directory when docs are configured.
- Bootstrap is optional and runs only through the rules command.

## Catalog discovery

- The default catalog is the `.rules` directory in the Agnos repository.
- Custom Git and local repository sources use their top-level `.rules` directory.
- An explicit Git repository path replaces the conventional directory.
- Discovery includes Markdown files recursively and presents repository-relative paths in sorted order.

## Copy behavior

- Selected files preserve their catalog-relative paths under `rules.dir`.
- Existing files at the same paths are overwritten.
- Bootstrap does not record copied files in project state or lock files.
- Dry runs report copy operations without changing the destination.

## References

- Rules command: [bootstrap.ts](../../src/domains/rules/bootstrap.ts).
- Rules configuration: [public.ts](../../src/core/types/public.ts).
