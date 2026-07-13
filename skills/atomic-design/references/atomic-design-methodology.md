# Atomic Design Methodology

## Sources

- [Atomic Design Methodology](https://atomicdesign.bradfrost.com/chapter-2/) by Brad Frost.
- [Atomic Design and ReactJS](https://danilowoz.com/blog/atomic-design-with-react) by Danilo Woznica.
- [danilowoz/react-atomic-design](https://github.com/danilowoz/react-atomic-design), used as a historical React/Storybook implementation example.

## Core Model

Atomic design breaks UI systems into five related stages: atoms, molecules, organisms, templates, and pages. Use the stages concurrently. The point is to move between abstract parts and concrete interfaces, not to build every atom before touching a page.

Atomic design applies to user interfaces broadly. It is not a CSS architecture, JavaScript architecture, React requirement, or folder-name mandate. Use the local codebase's language when it is clearer, but preserve the hierarchy of responsibility.

## Stage Guide

| Stage     | Definition                                                                                                                                      | Good implementation signals                                                                                               | Audit failures                                                                                                    |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Atoms     | The smallest functional UI building blocks, such as labels, inputs, buttons, icons, images, typography, colors, and animation primitives.       | Accessible defaults, explicit variants, token-driven styles, no knowledge of page placement.                              | Margins or positioning baked into controls, business records in props, inaccessible states, duplicate primitives. |
| Molecules | Simple groups of atoms working as one functional unit. A label, input, and button can become a search form molecule.                            | Single responsibility, portable behavior, small prop surface, states documented in isolation.                             | Too many unrelated options, duplicated atom behavior, direct route or global app coupling.                        |
| Organisms | More complex sections composed from molecules, atoms, or other organisms. Examples include headers, product grids, forms, and feature sections. | Distinct reusable interface section, clear slots or data contracts, resilient composition.                                | Hard-coded page copy, page-only layout assumptions, hidden dependencies on a single route.                        |
| Templates | Page-level layout objects that place components into structure and reveal content constraints.                                                  | Grid or slot ownership, skeleton states, character length and media constraints, placeholder or representative structure. | Production records, permissions, data fetching, route side effects, component internals.                          |
| Pages     | Specific instances of templates with real representative content and app integration.                                                           | Route wiring, user roles, empty and loaded states, long and short content, real interaction paths.                        | Repeating lower-level markup, hiding content stress cases, only testing happy-path copy.                          |

## React-Oriented Guidance

Use these rules as architecture guidance, not as framework requirements:

- Keep shared variables, tokens, and theme primitives centralized.
- Keep atoms free of page-specific margins and positioning.
- Let molecules and organisms compose and arrange their children, but keep their layout portable across contexts.
- Let templates define page grids, slots, and content structure.
- Let pages bind templates to real app state, routing, representative content, and variations.
- Use component examples or Storybook stories to show each meaningful state separately when the repo has that tooling.

The source repository demonstrates a common structure:

```text
src/components/
  _settings/
  atoms/<component>/
  molecules/<component>/
  organisms/<component>/
  templates/<component>/
```

Each sample component colocates implementation, styles, and stories. Borrow the colocated-example idea when it fits the repo, but do not copy its older Flow, Yarn, CSS Modules, or Webpack choices unless the project already uses them.

## Implementation Prompts

Use these questions while building:

- What is the smallest stage that should own this responsibility?
- Will the component work with different content, sizes, themes, and disabled or empty states?
- Is layout owned by the parent level rather than a low-level primitive?
- Does the template show the content structure without taking over page data?
- Does the page prove the design with real representative content and variations?
- Are component examples or tests covering the states users will actually encounter?

## Review Prompts

Use these checks while validating, reviewing, or auditing:

- Are atoms reusable without page context?
- Are molecules focused on one functional grouping?
- Are organisms complete interface sections without owning the route?
- Are templates structural instead of content-specific?
- Are pages connecting real app state without duplicating lower-level component internals?
- Are content stress cases represented, including long text, missing media, empty lists, role differences, and varied item counts?
- Are style tokens reused instead of copied?
- Are states discoverable through tests, stories, screenshots, or examples available in the repo?
