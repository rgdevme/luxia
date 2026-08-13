---
name: atomic-design
description: Atomic design methodology with type-filtered slot composition for UI implementation, validation, review, and audits. Use when implementing, validating, reviewing, or auditing frontend/UI code through atomic design principles, component hierarchy, atoms, molecules, organisms, templates, pages, reusable design systems, React-style compound components, named slots, child filtering by type, fixed slot positioning, Storybook or component state coverage, content structure, and page variation resilience.
---

# Atomic Design

Apply atomic design as a UI design-system mental model, not as a rigid build sequence. Organize components by logical responsibility using atomic design, then compose their variable regions through slots.

Read [Atomic Design Methodology](references/atomic-design-methodology.md) when you need the stage taxonomy, React-oriented placement rules, source notes, or detailed audit prompts.

Read [Slot-Based Composition](references/slot-based-composition.md) when you need compound component exports, child filtering by type, fixed slot positioning, or review prompts for slot composition.

## Workflow

1. Inspect the existing UI architecture before introducing atomic vocabulary.
2. Preserve the repo's naming, routing, styling, testing, and component patterns unless the user explicitly asks for a reorganization.
3. Map the target code to the smallest atomic stage that can own the responsibility.
4. Expose variable regions as slots when a component has stable structure but flexible content.
5. Check the same component in isolation and in its composed page context.
6. Validate with the repo's normal commands and with rendered UI inspection when visual behavior matters.

## Stage Ownership

| Stage    | Owns                                                                                                                                                        | Avoid                                                                      |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Atom     | Primitive UI elements, design tokens in use, accessible base controls, typographic primitives, icons, inputs, buttons.                                      | Page-specific layout, margins, route data, application workflows.          |
| Molecule | Small functional groups of atoms, such as search fields, form rows, nav items, summary badges, or card headers.                                             | Full page sections, global data fetching, unrelated optional regions.      |
| Organism | Distinct interface sections composed of atoms, molecules, or other organisms, such as headers, product grids, checkout forms, sidebars, and feature panels. | Route ownership, full-page layout skeletons, hard-coded page-only content. |
| Template | Page-level layout and content structure, including grid regions, slots, skeletons, and constraints for dynamic content.                                     | Final production copy, business-specific records, route side effects.      |
| Page     | Real representative content, route integration, application state wiring, user-role or data-volume variations, and final resilience checks.                 | Reusable component internals that belong lower in the hierarchy.           |

## Implementation Rules

- Prefer the existing component taxonomy. Introduce `atoms`, `molecules`, `organisms`, `templates`, and `pages` folders only when that matches or improves the local system.
- Keep dependencies flowing upward through the hierarchy: atoms should not import molecules, molecules may import atoms, organisms may import molecules and atoms, templates may import organisms and lower stages, and pages may wire all stages together.
- Keep atoms portable. They can expose variants and states, but they must not assume where they sit on a page.
- Compose molecules from atoms to create one focused function. Split a molecule when independent concerns start sharing props, state, or styles.
- Compose organisms as reusable interface sections. They may coordinate child layout but should stay independent enough to work in multiple page contexts.
- Keep templates about structure. They arrange regions and define content constraints without binding final records, permissions, or navigation behavior.
- Use pages to connect templates and components to real app data, routing, representative content, and meaningful variations.
- Centralize design tokens or variables according to the repo's existing style system. Do not duplicate token values inside components.
- Cover meaningful states where the repo supports component examples, stories, screenshots, or interaction tests.

## Slot-Based Composition Rules

- Use slots when props like `headerContent`, `footerActions`, `leftIcon`, or `descriptionNode` begin to multiply or when callers need to provide real JSX while the component owns structure.
- Prefer semantic compound slots such as `Card.Header`, `Card.Body`, `Card.Footer`, `Dialog.Title`, or `Toolbar.Action` for reusable molecules and organisms.
- Colocate slot components inside the owning component folder and export them from the root component API.
- Put generic child filtering in a shared `prepareComponentSlots` helper, then wrap it in a colocated hook named like `use<Component>Slots`.
- Let slot components import lower-stage components when needed. For example, a molecule slot may import an atom, but an atom slot must not import a molecule.
- Define slot components as function components. Type filtering compares `child.type` with the function reference registered in the slot map.
- Keep slot names semantic, not incidental. Prefer `Title`, `Description`, `Actions`, `Media`, and `Footer` over `Top`, `Left`, or `BlueArea` unless the component is explicitly a layout primitive.
- Filter slot children by component type when the parent owns positioning. The consumer may write slots in a readable order, but the parent renders each recognized slot into its defined region.
- Preserve DOM reading order and accessibility. Do not visually reorder slots in a way that creates a different keyboard or screen-reader order.

Example organization:

```text
src/
  components/
    atoms/
      component-a/
        index.tsx
    molecules/
      component-b/
        title.tsx
        body.tsx
        use-component-b-slots.ts
        index.tsx
```

Example slot hook:

```ts
import type { ReactNode } from "react";

import { prepareComponentSlots } from "../../hooks/prepare-component-slots.js";
import { Body } from "./body.js";
import { Title } from "./title.js";

const usePreparedComponentBSlots = prepareComponentSlots({
  body: [Body],
  title: Title,
});

export function useComponentBSlots(children: ReactNode) {
  return usePreparedComponentBSlots(children);
}
```

Example root export:

```tsx
import type { ReactNode } from "react";

import { Body } from "./body.js";
import { Title } from "./title.js";
import { useComponentBSlots } from "./use-component-b-slots.js";

export interface ComponentBProps {
  children: ReactNode;
}

export function ComponentBRoot({ children }: ComponentBProps) {
  const { body, title } = useComponentBSlots(children);

  return (
    <section>
      {title}
      <div>{body}</div>
    </section>
  );
}

export const ComponentB = Object.assign(ComponentBRoot, {
  Body,
  Title,
});
```

## Review And Audit Rules

- Report misplaced responsibilities as concrete code findings: atom with page layout, molecule doing route work, organism hard-coding one page, template owning production content, or page duplicating component internals.
- Check whether components remain reusable with different content lengths, empty states, disabled states, roles, and data volumes.
- Flag styling that breaks portability, especially margins and positioning buried in low-level atoms.
- Look for duplicate primitives or one-off components that should share an atom or molecule.
- Flag prop-heavy components that should expose named slots or compound subcomponents.
- Flag slots that break atomic dependency direction, hide business logic in reusable component internals, or require consumers to know private child ordering.
- Verify that templates expose content structure and that pages prove the structure with real representative content.
- Treat atomic design as a communication and resilience model. Do not require the exact stage names if the repo uses another clear taxonomy.
