# Slot-Based Composition

## Sources

- [Building Component Slots in React](https://sandroroth.com/blog/react-slots/) by Sandro Roth.
- [What is the React Slots pattern?](https://dev.to/neetigyachahar/what-is-the-react-slots-pattern-2ld9) by Neetigya Chahar.
- [Slot-Based APIs in React: Designing Flexible and Composable Components](https://dev.to/talissoncosta/slot-based-apis-in-react-designing-flexible-and-composable-components-7pj) by Talisson Costa.

## Model

Slot-based composition gives a component controlled insertion points for caller-provided content. Atomic design decides where a component belongs. Type-filtered slots decide how callers fill the component's stable structure while the parent guarantees positioning.

Use this pattern when a molecule, organism, or template has named regions that should stay structurally consistent while accepting flexible JSX. Avoid using it as ceremony for components with one simple `children` region.

## Required Pattern

- Expose semantic compound slot components from the parent API, such as `Card.Title`, `Card.Description`, and `Card.Actions`.
- Keep slot components colocated with the owning component.
- In the parent root component, inspect direct children and filter recognized slot components by their component type.
- Put generic child filtering logic in a shared `prepareComponentSlots` helper.
- Wrap the shared helper in a colocated component hook named like `use<Component>Slots`.
- Define slot components as function components. Type filtering compares `child.type` with the function reference registered in the slot map.
- Render each recognized slot in the parent's fixed structural position.
- Use a single component value for slots that should default to `null`, such as `title: Title`.
- Use an array containing one component value for slots that should default to an empty array, such as `body: [Body]`.
- Document behavior for missing slots, duplicated slots, unknown children, and ordering.

## Atomic Placement

- Atoms may expose a default slot through `children` for primitive content.
- Molecules are the usual home for named slots because they group atoms into one small function.
- Organisms may expose larger slots for section regions, actions, filters, media, empty states, or summaries.
- Templates may expose layout slots or render props for page regions, but they must not own final route data.
- Pages fill slots with real content, route wiring, permissions, and state variations.

## Folder Shape

Use the owning component folder as the boundary for slot files:

```text
src/components/
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

The slot file can import lower-stage components:

```tsx
import type { ReactNode } from "react";

import { ComponentA } from "../../atoms/component-a/index.js";

export interface TitleProps {
  children: ReactNode;
}

export function Title({ children }: TitleProps) {
  return <ComponentA>{children}</ComponentA>;
}
```

The shared helper is declared in [prepareComponentSlots](./prepareComponentSlots.ts). Copy it into the project's shared hooks or utilities area using the project's local file naming and import conventions.

The colocated component hook wraps the shared helper:

```tsx
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

The root file consumes the colocated hook, exports the component, and attaches its slots:

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

Consumers compose through the parent API:

```tsx
<ComponentB>
  <ComponentB.Body>Additional body content.</ComponentB.Body>
  <ComponentB.Title>Project status</ComponentB.Title>
</ComponentB>
```

The parent still renders the title and body in the order defined by `ComponentBRoot`.

With `prepareComponentSlots`, missing single slots resolve to `null`, missing array slots resolve to `[]`, duplicate single slots use the last matching child, duplicate array slots collect every matching child, and unknown children are ignored.

## Implementation Rules

- Prefer one composition pattern per component family.
- Keep slot components small and semantic. They should name a region, provide structure, or adapt lower-level components.
- Keep business decisions at pages or feature-level integration points, not inside reusable slot components.
- Preserve accessible DOM order. If the parent normalizes slot regions, its rendered order must be the correct reading and keyboard order.
- When normalizing slots by child type, provide clear behavior for missing, duplicated, unknown, and fallback children.
- Keep child filtering shallow unless the component explicitly documents nested slot support.
- Keep the hook focused on resolution. Rendering and layout stay in the root component.
- Keep the generic helper shared and the component-specific hook colocated with the component.

## Review Prompts

- Does the atomic stage own the component's responsibility?
- Does the slot API reduce prop bloat without hiding required structure?
- Are slots named after domain or semantic regions?
- Can consumers omit optional slots without layout breakage?
- Are required slots validated by types, tests, stories, or runtime guards according to local practice?
- Does the implementation preserve accessible DOM order and keyboard flow?
- Are lower-stage imports flowing in the correct direction?
- Is slot resolution implemented once in a hook instead of duplicated across roots, stories, or tests?
- Are examples or stories covering default content, each named slot, missing optional slots, duplicated slots, unknown children, and consumer order that differs from rendered order?
