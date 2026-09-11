---
type: Rule
title: Dependency Management
description: Add, update, and remove project dependencies deliberately and safely.
resource: ""
tags: [dependencies, packages, maintenance]
timestamp: 2026-08-19T00:00:00Z
---

- Inspect the project manifests, lockfiles, workspace configuration, and existing dependencies before making changes.
- Use the package manager and versioning policy already established by the project.
- Do not introduce a competing package manager or lockfile.
- Prefer existing platform capabilities and installed dependencies over adding another package.
- Add a dependency only when it directly supports an approved requirement.
- Keep dependency changes limited to the requested scope.
- Do not perform unrelated upgrades or lockfile refreshes.

### Selecting dependencies

- Prefer maintained dependencies with compatible licenses, runtimes, and peer requirements.
- Evaluate security history, release activity, bundle or runtime cost, and transitive dependencies.
- Prefer focused dependencies over broad frameworks when only a narrow capability is required.
- Place dependencies in the narrowest correct production, development, optional, or peer scope.

### Changing dependencies

- Update manifests and lockfiles together using the project package manager.
- Review install scripts and generated changes before accepting them.
- Confirm that a dependency is unused before removing it.
- Remove obsolete configuration, imports, and documentation with a removed dependency.
- Run the project checks affected by the dependency change.
