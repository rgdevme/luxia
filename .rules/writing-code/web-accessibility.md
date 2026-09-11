---
type: Rule
title: Web Accessibility
description: Build web interfaces that support assistive technology and diverse interaction needs.
resource: ""
tags: [accessibility, web, user-interface]
timestamp: 2026-08-19T00:00:00Z
---

## Web accessibility

- Follow the project's accessibility target or WCAG 2.2 Level AA when no target is declared.
- Prefer native semantic elements and browser behavior over custom controls.
- Provide accessible names for interactive controls and meaningful alternatives for non-text content.
- Associate labels, instructions, validation messages, and errors with their controls.
- Preserve heading hierarchy, landmarks, reading order, and language metadata.
- Do not communicate meaning through color, position, shape, sound, or motion alone.

### Interaction and focus

- Make every interactive behavior operable with a keyboard.
- Use a logical focus order and visible focus indicators.
- Move focus only when the interface context changes and users need that context.
- Return focus after closing temporary interfaces when the previous control still exists.
- Provide a way to bypass repeated navigation.
- Ensure pointer targets and interactions do not require precise movement.

### Dynamic interfaces

- Use ARIA only when native semantics cannot express the required behavior.
- Keep names, roles, values, expanded state, selection state, and validation state synchronized with the interface.
- Announce important asynchronous updates without interrupting unrelated work.
- Support zoom, text resizing, reflow, contrast preferences, reduced motion, and forced-color modes.
- Do not use time limits, animation, or automatic movement without necessary controls.

### Verification

- Combine automated accessibility checks with keyboard and assistive-technology review for changed user flows.
- Verify accessible names, roles, states, focus behavior, error recovery, contrast, reflow, and reduced motion.
- Treat accessibility failures as product defects.
