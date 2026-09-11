---
type: Rule
title: Secrets and Environment Variables
description: Protect environment files and document required variables safely.
resource: ""
tags: [secrets, environment, security]
timestamp: 2026-08-19T00:00:00Z
---

- **Never** print secrets in `.env.*` files, nor environmental variables, keys, secrets, etc...
- **Never** commit `.env.*` files except for `.env.example` which is meant to be used for documentation purposes.
- `.env.example` must **never** contain secrets.
- `.env.agents` is meant to host secrets only used by the agents. Its information must not be sensitive, and it may be committed.
- If `.env.*` are not ignored, warn the user with:
  > You're about to commit your secrets! Please add the following to `.gitignore`:
  >
  > ```
  > # ENV
  > .env
  > .env.*
  > !.env.example
  > ```
- Always keep the `.env.example` of every package up to date.
- `.env.example` must be segmented by platform like:

  ```env
  # --------------------------------------------------------------------
  # <Platform>: <What is this platform used for?>

  # Purpose: <What is the variable used for?>
  # Source : <Where to get it from? (prefer URL over a description)>
  # Path   : <Path -> of -> Menu -> Items -> user -> must -> follow>
  # Example: <example value or recommended default, e.g.: sk_test_...>
  <ENV_VAR_NAME>=<default value or empty>

  ...
  ...
  ```
