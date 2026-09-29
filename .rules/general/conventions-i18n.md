---
type: Rule
title: "Internationalization: modular i18n"
description: Define shared reuse, module, and localization conventions.
resource: ""
tags: [conventions, i18n, internationalization]
timestamp: 2026-08-19T00:00:00Z
---

- Always **prepare for i18n**.
- Hardcoded strings in components are a defect.
- Co-locate dictionaries next to the consuming organism.
- Never bundle all strings into a single dictionary file. Keep one disctionary per supported language.
- Use a schema file to define the `i18nSchema`, the Zod schema for the dictionary.
- Dictionaries (json files) are always fetched over the network and validated with the zod schema once received.

```
src/
└─ .../<domain>/
    ├─ index.ts
    ├─ ...
    ├─ <domain>.i18n._schema.ts
    └─ <domain>.i18n.<lang>.json
```

```ts
// .../<domain>.i18n._schema.ts
import z from 'zod'

// declare the shape of the dictionary
export const i18nSchema = z.object({ ... })

// .../<domain>.<role>.ts
import { i18nSchema } from './<domain>.i18n._schema.ts'

export const DomainRole = async () => {
    // fetch json dictionary
    const json = await fetchI18nLang(lang)
    // validate it with the schema
    const validDictionary = i18nSchema.safeParse(json)
    ...
}
```
