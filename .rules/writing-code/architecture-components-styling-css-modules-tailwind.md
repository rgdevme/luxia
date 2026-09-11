---
type: Rule
title: "Architecture: Styling with CSS Modules and Tailwind"
description: Write component styles with CSS Modules and shared Tailwind settings.
resource: ""
tags:
  - css
  - tailwind
  - components
timestamp: 2026-08-19T00:00:00Z
---

## Component styling

When styling components, always follow these rules:

- Read the project's design system documentation.
- Use CSS Modules for component styles.
- Keep each module beside the component that imports it.
- Name component style files `index.module.css`.
- Import module classes through the generated `styles` object.
- Do not add component selectors to a global stylesheet.

### Styling components with Tailwind

- Use Tailwind utilities through `@apply` instead of CSS properties.
- Use the closest standard Tailwind value when an exact value is unavailable.
- Do not use arbitrary values or custom-property utility syntax unless explicitly asked to.
- Add a shared theme value only when the value represents a reusable design decision.
- Consume colors from the common theme through Tailwind classes.
- Do not write color values directly in components or CSS Modules.

#### Global references

- Start every component CSS Module with `@reference` to that project's `globals.css`.
- Use the reference only to make the shared Tailwind theme available to `@apply`.
- Keep `globals.css` limited to theme imports, root elements, browser defaults, selection, focus, media preferences, and other shared root-level behavior.

#### Variants

- Use one base module class for styles shared by every variant.
- Add semantic data attributes to the rendered element for variant state.
- Select data attributes inside the base module class.
- Do not build modifier class names from component props.

```tsx
<button className={styles.button} data-variant={variant} />
```

```css
@reference "../../../app/globals.css";

.button {
  @apply inline-flex items-center;

  &[data-variant="primary"] {
    @apply bg-yellow-400 text-sage-950;
  }
}
```

### Shared design source

- Read the visual intent in [Design system](../design.md).
- Consume theme values from `packages/common/src/styles/theme.css`.
- Do not duplicate shared fonts, colors, or motion settings in project stylesheets.
