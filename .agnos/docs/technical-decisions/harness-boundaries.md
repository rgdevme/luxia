---
type: Technical Decision
title: Repository Configuration and Harness Boundaries
description: Defines Agnos ownership for repository content, harness translation, and harness-specific runtime configuration.
resource: ""
tags: [architecture, harnesses, skills, mcp]
timestamp: 2026-10-25T00:00:00Z
---

# Repository Configuration and Harness Boundaries

## Decision

Agnos maintains repository-bound environment configuration: rules, docs, skills, repository references, and MCP declarations. The `harness` domain renders that content for configured harnesses. Harness adapters own native file formats and skill metadata compatibility checks.

Hooks and permissions remain harness-specific configuration. Agnos does not normalize, import, render, or remove them. Existing native hook and permission files are preserved during rendering and harness cleanup. MCP remains in scope because Agnos uses one shared declaration and adapters translate it to each harness format.

Custom agents are a separate future domain named `agents`. This change reserves that name and does not implement custom agent declarations. OpenCode, Hermes, and Pi adapters are deferred.

## Consequences

- The current `agents` config key and CLI domain become `harness`; old `agents` configuration receives a manual cutover error.
- Hook declarations are removed from Agnos configuration and commands. Existing native hooks stay in place for users to manage directly.
- Each harness adapter owns its compatibility rules. Skill findings are warnings and never block installation or enablement.
- Core coordinates validation and rendering without maintaining a catalog of every harness-specific metadata property.
