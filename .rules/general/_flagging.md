---
type: Rule
title: Flagging
description: Define the flagging and warning behavior.
resource: ""
tags: [flag, warn, recommendation]
timestamp: 2026-08-19T00:00:00Z
---

Whenever asked to flag something, add the flagged content at the end of your response with the following format:

> ⚠️ **<type> gap detected:** <decision-summary>.
> Recommendation: <recommended-action>
> _Consider updating [`<filename>`](targeted-file-path.md)_.
