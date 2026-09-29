---
title: "Principle: Atomic Aesign"
---

When designing, building, and organizing components, assess their level in the following scale according to their responsibility and composition, and use the level to place them in the correct directory:

1. **Atoms**: located at `.../atoms/`. The smallest indivisible UI elements, such as buttons, icons, labels, inputs, and typography. They provide basic styling and behavior but little meaning on their own.
2. **Molecules**: located at `.../molecules/`. Small combinations of atoms that perform one focused task. For example, a labeled input, search field with a button, or avatar with a username.
3. **Organisms**: located at `.../organisms/`. Larger, self-contained interface sections composed of atoms and molecules. Examples include navigation headers, product cards, forms, and data tables.
4. **Templates**: located at `.../templates/`. Page-level structures that arrange organisms into a reusable layout. They define content hierarchy and placement without depending on final, page-specific content.
5. **Pages**: located at `.../pages/`. Concrete instances of templates populated with real content and application data. Pages represent what users actually visit and are useful for validating the complete experience.

The dependency direction (from higher levels to lower ones) is:

```
Page
 └🡪 Template
     └🡪 Organism
         └🡪 Molecule
             └🡪 Atom
```

Where the higher levels may import from lower levels, but lower levels may never import from higher ones.
