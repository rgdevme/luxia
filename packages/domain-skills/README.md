# @luxia/domain-skills

[![npm version](https://img.shields.io/npm/v/@luxia/domain-skills?color=18181B&label=npm&style=flat-square)](https://www.npmjs.com/package/@luxia/domain-skills)
[![license](https://img.shields.io/npm/l/@luxia/domain-skills?color=18181B&style=flat-square)](https://github.com/rgdevme/luxia/blob/main/LICENSE)

[agnos](https://github.com/rgdevme/luxia) domain plugin that owns the **skills** category. Pull skill packs from git or local sources, lock them by content hash, and expose them to every agent through a single directory.

## What it does

- Owns the `skills` block in `agnos.json` — `route` (where canonical content lives) and `sources` (composite source refs keyed by local skill name).
- Owns `.agnos/skills/` (canonical content) and `.agnos/cache/` (gitignored fetch cache).
- Resolves each source ref through `core`'s `RepoFetcher` and `prepareSkills`, materializing the canonical bytes under `.agnos/skills/<name>/`.
- Lets agents opt in declaratively: any agent that declares `paths.skillsDir` gets a symlink from that path to `.agnos/skills/`, so every current and future skill flows through automatically.
- Locks each fetched skill by content hash in `.agnos/skills.lock.json`.

## Why a single canonical directory?

So adding a skill is _one_ operation, not _N_ (where _N_ is the number of agents you have enabled). Drop a skill in once; every agent that opts in sees it.

## Install

You usually get this for free with [`@luxia/agnos`](../agnos/README.md). Standalone:

```sh
pnpm add -D @luxia/domain-skills
```

## Configuration

```json
{
  "skills": {
    "route": ".agnos/skills",
    "sources": {
      "pdf": "github:vercel-labs/agent-skills/skills/pdf",
      "convex-functions": "github:get-convex/agent-skills/skills/convex-functions",
      "review": "file:./skills/review"
    }
  }
}
```

- `route` (optional, default `.agnos/skills`) is the canonical directory where skill content is materialized.
- `sources` is the map of local skill name → composite source ref. Grammar:
  - `github:<owner>/<repo>/<in-repo-path>` (or `gitlab:`, `bitbucket:`)
  - `file:<path-to-skill-dir>` (the directory contains `SKILL.md` directly)

## CLI

| Command                                           | What it does                                                                                                                |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `agnos skill add <source>`                        | Add skills from a repo or local dir. With a sub-path, installs that one skill. Without, discovers `./skills/*` and prompts. |
| `agnos skill add <source> -s "claude-*,convex-*"` | Filter discovery by glob.                                                                                                   |
| `agnos skill update <name> [--ref <r>]`           | Re-fetch a skill (and its repo siblings) at a new commit, branch, or tag.                                                   |
| `agnos skill remove <name>`                       | Remove a skill from `.agnos/skills/` and the manifest.                                                                      |
| `agnos skill list`                                | List installed skills.                                                                                                      |

## How agents see skills

The skills domain reads each agent's `paths.skillsDir`. If set, it creates a symlink from that path to the canonical `.agnos/skills/` directory:

- Claude Code: `.claude/skills/` -> `.agnos/skills/`
- Codex: `.agents/skills/` -> `.agnos/skills/`

If an agent supplies its own `handles.skills` handlers, the domain steps aside and lets the agent decide. If multiple active agents resolve `paths.skillsDir` to the same absolute path (e.g. two agents both want `.agents/skills/`), the link is created once and reference-counted on deactivation.

## License

MIT.
