---
type: Technical Doc
title: Repository References
description: How project declarations link selected directories from shared global repository checkouts.
resource: ""
tags: [repositories, references, configuration]
timestamp: 2026-10-22T00:00:00Z
---

# Repository References

## Configuration

`agnos.json` declares references under `references.sources`, keyed by the project-local link name. Each request contains a repository source and may specify a branch, commit pin, or repository-relative glob. The project link directory is configured with `references.dir` and defaults to `.agnos/references`.

Each reference selection must resolve to exactly one directory. The project route contains one directory link per declaration. The repository and checkout are shared through the global repository catalog.

## Lifecycle

`agnos references` checks declared live branches and reports whether they are current. It warns when a reference has not been installed and recommends `agnos references --init`. `agnos references --init` installs declarations and repairs links without advancing an existing checkout. `agnos references add` acquires and links a request. `agnos references pull` fast-forwards live checkouts, while explicit commit pins are reported as skipped. `agnos references remove` deletes the project link and releases only that consumer.

Initialization does not remove links or release registrations for declarations removed from `agnos.json`, and changing `references.dir` does not move existing links. Remove stale links manually or use `agnos references remove` before changing the declaration.

## Project isolation

The reference route is ignored by Git, excluded from npm and pnpm workspaces, and skipped by Agnos documentation scans and recursive watchers. Agnos does not install dependencies, initialize submodules, or run scripts in referenced repositories.

See [Repository Tracking](repository-tracking.md) for checkout identity, sharing, updates, and cleanup behavior.
