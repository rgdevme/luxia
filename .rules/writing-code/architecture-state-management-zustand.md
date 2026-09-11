---
type: Rule
title: "Architecture: State Management with Zustand"
description: Manage shared client state with Zustand stores and selectors.
resource: ""
tags: [state-management, react, zustand]
timestamp: 2026-08-19T00:00:00Z
---

## Zustand state management

Always use **Zustand** for all client-side global state management.
If Zustand is not installed as a dependency in the project, install it.
Do not use React Context for state that is read by many components or updated frequently.

### Managing state with Zustand

Always follow these rules to manage state with Zustand:

- Each store lives in its own file under `stores/` named `use<Domain>Store.ts` (e.g. `stores/useCartStore.ts`).
- Keep stores minimal: only state that must be shared across unrelated components belongs in a store. Prefer co-located `useState` / `useReducer` for component-local state.
- Use the **slice pattern** when a store grows beyond ~5 actions: split into slice creators and combine them in the store file.
- Always define a TypeScript interface for the store shape and use `create<StoreShape>()`.
- Derive computed values with selectors, not stored duplicates: `const total = useCartStore(s => s.items.length)`.
- Prefer **atomic selectors** over selecting the entire store to avoid unnecessary re-renders.
- Persist state to `localStorage` only when explicitly required (e.g. cart, theme preference) using Zustand's `persist` middleware.
