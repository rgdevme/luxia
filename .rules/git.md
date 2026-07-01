---
title: Working with Git
---

### History management

- Maintain a linear history: Prioritize `rebase` and `squash` over `merge`.
- Never take credit for code authoring. The author is always the developer.
- Don't ever sign commits.

### Branch management

- **`main` branch is locked**: Never push to `main` directly, instead create a branch and a PR.
- Strictly adhere to **[conventional branches](conventionalbranch.org/#specification)**.
- Branch names can never be called `<ai-agent-name>/*`. They have to strictly follow the conventional names.

### Commit strategy

- Strictly adhere to **[conventional commits](conventionalcommits.org/en/v1.0.0/#specification)**
- - Conventional multi-line messages: subject < 70 chars in imperative mood; body explains why.
- Always group related changes logically and split unrelated work. Do not do a big single commit. Do not commit atomically.
- Never amend pushed commits without explicit approval. Never --no-verify.

### Pull-requests

- Use `gh auth switch -u <GH_USER>`: Always use the `GH_USER` secret declared in `.env.agents` to work with the gh cli.
