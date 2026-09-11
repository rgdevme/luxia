---
type: Rule
title: "Architecture: React Components"
description: Organize and write React components, slots, and forms.
resource: ""
tags:
  - components
  - react
timestamp: 2026-08-19T00:00:00Z
---

## React component architecture

Always follow these rules when writing React components:

- Use the **Atomic Design Principles** to organize components.
- Use **Slot-based composition** when a component has multiple named layout regions, and its parts may not be reused by other components.
- Place each component in its own folder, following the atomic design principles and slot-based composition rules.
- Components are for presentation. Extract complex logic into hooks.

### Writing components

- Keep the `props` surface as small as possible.
- Use a store instead of props when:
  - a prop has to be passed down more than one level.
  - a prop must be consumed by more than one component.
  - it helps to avoid prop-drilling.
- Always use `PropsWithChildren`. Avoid manually typing children.
- Modularize components into independent files, unless the components are closely related and their surface is small.
- Do not use thin wrapper components (components that wrap and export another component without handling any logic).

#### Example

```jsx
// MyComponent.tsx
type MyComponentProps = PropsWithChildren<{ /* ... */ }>

export const MyComponent = ({ ...props }: MyComponentProps) => { /* ... */ }
```

### Form components

- Place each form in `src/components/forms/<Form>/`.
- Manage forms with Mantine's `useForm`.
- Use controlled mode. Do not use `form.key(<field>)`.
- Provide complete `initialValues` on the first render.
- Do not gate input props on `form.initialized`.
- Use uncontrolled mode only to solve a measured rendering problem.
- Use `FunctionArgs<typeof api.<mutation>>` for payload types.
- Do not derive form types from `Doc<...>`.
- Use `form.submitting` instead of duplicate submission state.
- Return the submission promise so `form.submitting` remains accurate.
- Use `requestSubmit()` for triggers outside `<form>`.
- Do not add stories to forms. Add stories to their reusable atoms and molecules.

#### Folder structure

```text
src/
  components/
    forms/
      <Form>/
        index.ts
        presentation.tsx
        bootstrap.ts
        actions.ts       # optional
        schemas.ts       # optional
        codec.ts         # optional
  schemas/
    <entity>/
      <response>.ts
  utils/
    forms.ts
```

- `index.ts` exports `<Form>` and `use<Form>`.
- `presentation.tsx` contains fields and layout.
- `bootstrap.ts` configures and exports `use<Form>`.
- `actions.ts` contains form-specific submission orchestration.
- Create `actions.ts` only when submission does more than invoke one mutation or function, such as formatting payloads or coordinating operations.
- Do not create `actions.ts` only to import, wrap, or re-export one mutation or function.
- `schemas.ts` contains form-specific presentation and payload schemas.
- `codec.ts` transforms between presentation values and payloads.
- `src/schemas/<entity>/` contains reusable response schemas.
- `src/utils/forms.ts` contains shared form helpers.
- Keep optional form files private. Move them only when they gain a consumer outside the form.

#### Data and schemas

- Type responses.
- Create `src/schemas/<entity>/<response>.ts` only when the response needs:
  - runtime validation.
  - normalization or transformation.
  - initial or default values.
- Use Zod `.default()` for response defaults.
- Share response schemas across forms, hooks, and views.
- Keep payload types and schemas inside the form.
- Create a payload schema when it needs runtime validation or differs from the presentation shape.
- Use the fetched response shape as the presentation shape when possible.
- Submit values directly when the presentation and payload shapes match.
- Create a transformer only when the shapes differ.
- Prefer a Zod codec for pure, bidirectional transformations.
- Use functions for one-way, lossy, contextual, or effectful transformations.
- Keep complex payload formatting and coordinated persistence in `actions.ts`.

```tsx
// src/schemas/<entity>/<response>.ts
export type Response = // ...
export const responseSchema: z.ZodType<Response> = z.object({
  <field>: z.string().default(""),
})

// src/components/forms/<Form>/schemas.ts
export type Payload = // ...
export const payloadSchema: z.ZodType<Payload> = z.object({
  <field>: z.string(),
})

// src/components/forms/<Form>/codec.ts
export const formCodec = z.codec(payloadSchema, responseSchema, {
  decode: (payload) => <toPresentationValues>,
  encode: (values) => <toPayload>,
})
```

#### Ownership

- `bootstrap.ts` must:
  - configure `initialValues`, `validate`, `transformValues`, and `enhanceGetInputProps`.
  - accept data and configuration only. Do not accept callbacks such as `onSubmit`.
  - define `submit` directly when it only calls one mutation or function.
  - obtain `submit` from `actions.ts` when submission requires orchestration.
  - return `{ form, submit }`. Do not bind `form.onSubmit`.
  - hydrate asynchronous response data with `setInitialValues`, `setValues`, and `resetDirty`.
  - parse response data before hydration when a response schema exists.
  - use shared prop enhancers for lifecycle state such as `disabled`.
- When present, `actions.ts` must:
  - format the mutation payload and persist it.
  - not show notifications, navigate, close UI, or invoke consumer callbacks.
- `presentation.tsx` must:
  - receive the form through a `form` prop.
  - own field layout, state, and presentation.
  - not render `<form>`, fetch data, submit, or own submit triggers.
- The consumer must:
  - import the form and hook from `index.ts`.
  - render `<form>`.
  - declare `handleSubmit` and call `submit` inside it.
  - bind `handleSubmit` with `form.onSubmit`.
  - own submission triggers and effects.

```tsx
// src/components/forms/<Form>/bootstrap.ts
export const use<Form> = () => {
	const form = useForm<Response, Payload>({
		initialValues: responseSchema.parse({}),
		validate: schemaResolver(responseSchema, { sync: true }),
		transformValues: (values) => z.encode(formCodec, values),
		enhanceGetInputProps: enhanceInputPropsWithDisable(),
	})
	const submit = useMutation(api.<entity>.<mutation>)

	return { form, submit }
}

// src/components/forms/<Form>/presentation.tsx
export const <Form> = ({ form }: <Form>Props) => (
  <Input {...form.getInputProps("<field>")} />
)

// src/components/forms/<Form>/index.ts
export { use<Form> } from "./bootstrap"
export { <Form> } from "./presentation"
```

```tsx
// <Consumer>.tsx
export const Consumer = () => {
  const formRef = useRef<HTMLFormElement>(null);
  const { form, submit } = use<Form>();
  const handleSubmit = async (payload: Payload) => {
    await submit(payload);
    // <runConsumerEffects>
  };

  return (
    <>
      <form ref={formRef} onSubmit={form.onSubmit(handleSubmit)}>
        <Form form={form} />
      </form>
      <Button type="button" onClick={() => formRef.current?.requestSubmit()} />
    </>
  );
};
```

#### References

- Read [`useForm`](https://mantine.dev/form/use-form/) for configuration and values.
- Read [schema validation](https://mantine.dev/form/schema-validation/) for Zod validation.
- Read [`getInputProps`](https://mantine.dev/form/get-input-props) for prop enhancers.
- Read [uncontrolled mode](https://mantine.dev/form/uncontrolled/) before using it.
