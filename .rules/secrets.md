---
title: Secrets and environmet variables
---

- **Never** print secrets in `.env` files, nor environmental variables, keys, secrets, etc...
- Always keep the `.env.example` of every package up to date.
- `.env.example` must be segmented by platform like:

  ```env
  # ——————————————————————————————————————————————————————————————————————————
  # ——— <Platform>: <What is this patform used for?>

  # Use   : <What is this variable used for?>
  # Source: <Where to get it from?>
  # Path  : <Path > of > Nested > Menu > Items >
  # E.g.  : <example value or recommended default>
  <ENV_VAR_NAME>=<Recommended default or empty>
  ...
  ```

- `.env.agents` is meant to be read by agents. Never put secrets that are neede by other processes inside of it.
