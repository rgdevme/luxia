---
type: Technical Doc
title: Repository Tracking
description: How Agnos stores repository checkouts globally and shares them between project consumers.
resource: ""
tags: [repositories, storage, references, skills]
timestamp: 2026-10-22T00:00:00Z
---

# Repository Tracking

## Storage and identity

`RepositoryTracker` stores bare repositories and worktrees under the versioned global store selected by `AGNOS_STORE_DIR` or the platform data directory. A repository identity is shared across branch and content selections. Each branch or pinned commit has a distinct checkout, while different globs over the same branch reuse its checkout.

Repository URLs may use HTTPS or SSH transports, supported provider shorthand, or browser URLs that identify a branch and repository-relative selection. An omitted branch resolves from the remote's advertised `HEAD`. An explicit commit is resolved to its full hash and gets a detached checkout. A missing glob selects the repository root.

The catalog records each normalized selection and its consuming project, domain, and local name. Removing a consumer leaves shared data in place while another selection or consumer uses the checkout. The last consumer releases a clean checkout and removes the bare repository when no checkouts remain. Dirty checkouts are retained and reported.

## Freshness and updates

Freshness checks fetch remote branch refs and compare the selected branch worktree's commit to its upstream ref. Pinned checkouts are immutable and always report current. Updates use a fast-forward-only pull and refuse dirty or divergent worktrees. They do not reset, stash, merge, rebase, initialize submodules, or run repository scripts.

The tracker serializes store mutations with a cross-process lock. Bare clones are staged before publication, and the catalog is atomically replaced so interrupted operations can be retried.

## Consumers

References link a selected repository directory into the configured project route. Skills retain their content hash and lock metadata while Git acquisition is handled by the shared tracker. Rules bootstrap acquires a temporary repository consumer, copies selected files, and releases the consumer after the copy completes.

Project declarations remain in `agnos.json`. Checkout locations and consumer registrations are tool-managed in the global repository catalog. Consumers are found by project config path, domain, and declaration name. Queries read existing registrations without fetching or changing storage. Normal initialization installs current declarations and repairs their links, but does not release registrations for declarations removed manually from the config. Those registrations may remain until an explicit removal or replacement.

## Isolation

Reference routes are ignored by Git and excluded from npm and pnpm workspace package lists. Docs scans and recursive watchers ignore the reference route. Reference repositories are directory links, not submodules or nested dependency installations.
