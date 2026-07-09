---
type: Technical Doc
title: MCP Env Resolution
description: How MCP env key declarations are resolved into secret-bearing agent files.
resource: ""
tags: [configuration, mcp, secrets]
timestamp: 2026-07-09T00:00:00Z
---

# MCP Env Resolution

## Declaration model

- `agnos.json` stores MCP configuration under an object with server declarations.
- Server env declarations are key names, not values.
- The env file path is declared once for MCP configuration.
- If no env file is declared, Agnos resolves keys from the project root `.env.local`.

## Materialization

- Agent files are secret-bearing local outputs.
- During materialization, Agnos reads the MCP env file and resolves each declared key.
- Missing files, missing keys, and empty values prevent the MCP slice from rendering.
- Error messages list key names and file labels only.
- Env values are never written back to `agnos.json`.

## Imports

- Native agent MCP imports preserve env key names and drop env values.
- Header declarations keep their existing explicit map shape.

## References

- Config schema: [schema.json](../../schema.json).
- MCP env resolver: [mcp-env.ts](../../src/domains/agents/mcp-env.ts).
- MCP domain: [index.ts](../../src/domains/mcp/index.ts).
