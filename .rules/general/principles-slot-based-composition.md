---
title: "Principle: Slot based composition"
---

Use slot-based composition when you need a reusable UI component to maintain a fixed structure, styling, or behavior while letting parent elements inject flexible, custom inner content.

Avoid slots based composition when a component has only one content region.

### Anatomy of a slot based component

1. A `host` component to own the layout: structure, order, responsiveness, and accessibility.
2. One or many `slots` components to declare the presentation of each of the layout's regions.

Consumer components provide the content. Host and slot components concern only with presentation and layouts.

### Rules for host components

Host components must:

- Keep host-specific components and hooks private.
- Be declared using **arrow functions**.
- Use `useComponentSlots` to define the allowed slot components for a parent component.
- Use `index.tsx` to export the compound host.
- Expose slots only through `Host.Slot` from `index.tsx`. Never allow direct imports from `components/` and `hooks/`.

### Rules for slot components

Slot components must:

- Be declared using **named functions**.
- Use semantic slot names such as `Header`, `Content`, `Actions`, `Filters`, etc...
- Not be used for data-driven repeated content.

Move a slot component to the respective level in the top-most shared components folder of the project (usually `src/components/`) when any of these conditions apply:

- It gains a second consumer.
- It has an independent purpose outside its parent.
- It no longer depends on its parent’s internals.

Do not move it based only on size or hypothetical reuse.

### Folder structure

```text
src/components/
 └─ <hostComponent>
    ├─ index.tsx
    ├─ <domain>.component.ts
    ├─ <domain>.hook.<useHook>.ts
    ├─ <domain>.module.css
    ├─ <domain>.store.ts
    └─ components/
        ├─ slotComponentA
        │   ├─ <slotDomain>.module.css
        │   └─ <slotDomain>.component.ts
        └─ slotComponentB
            ├─ <slotDomain>.module.css
            └─ <slotDomain>.component.ts
```

### Example with React

```jsx
// src/components/host/components/slot/slotA.component.tsx
type SlotAProps = PropsWithChildren<{ /* ... */ }>

// Declare the slot component:
export function SlotA({ ...props }: SlotAProps) {/* ... */}

// src/components/host/host.component.tsx
import { SlotA } from './components/slot/slotA.component.tsx'

type HostProps = PropsWithChildren<{ /* ... */ }>

// Declare the host component:
const Host = ({ ... }: HostProps) => {
  const slots = useComponentSlots({ slot: SlotA }, props)

  return <div>
    {/* ... */}
    {slots.slot}
    {/* ... */}
  </div>
}

// Compound and export the host component
Host.SlotA = SlotA
export { Host }

// Consumer.tsx
import { Host } from "Host"

const { SlotA } = Host

// Consume the slot-based component:
export const Consumer = () => (
  <Host>
    <SlotA />
  </Host>
)

// useComponentsSlots.ts
import type { ReactNode } from 'react'
import { Children, isValidElement, useMemo } from 'react'

type SlotComponent = (props: never) => ReactNode
type SlotDefinition = SlotComponent | SlotComponent[]
type Definitions = Record<string, SlotDefinition>
type PreparedSlots<T extends Definitions> = Record<keyof T, ReactNode[]>
interface UseComponentSlotsProps<T extends Definitions> {
	definitions: T
	children: ReactNode
}

export function useComponentSlots<T extends Definitions>({
	children,
	definitions
}: UseComponentSlotsProps<T>): PreparedSlots<T> {
	return useMemo(() => {
		let defaultProp = undefined
		const preparedSlots = {} as PreparedSlots<T>
		const entries: {
			key: Extract<keyof T, string> | undefined
			limit: number
			definition: SlotComponent[]
		}[] = []

		for (const key in definitions) {
			preparedSlots[key] = []

			const definition = definitions[key]
			const isArray = Array.isArray(definition)
			if (definition)
				entries.push({
					key,
					definition: [definition].flat(1),
					limit: isArray ? -1 : 1
				})

			const isDefaultProp = isArray && !!definition.length
			if (!isDefaultProp) defaultProp = key
		}

		for (const child of Children.toArray(children)) {
			if (!isValidElement(child)) continue

			const match = entries.find(({ definition }) =>
				definition.includes(child.type)
			)

			if (!match && !defaultProp) continue

			const key = match?.key ?? defaultProp
			const limit = match?.limit ?? -1

			if (!key) continue

			if (limit >= 0 && limit >= preparedSlots[key].length) continue
			preparedSlots[key].push(child)
		}

		return preparedSlots
	}, [children, definitions])
}
```
