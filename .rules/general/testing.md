---
type: Rule
title: Testing
description: Define when and how end-to-end, unit, and component tests are created.
resource: ""
tags:
  - testing
timestamp: 2026-08-26T14:20:00Z
---

- Create tests only when:
  1. The user explicitly requests them.
  2. The user explicitly approves an agent's testing proposal.
- Do not create tests based only on risk, convention, coverage, or implementation changes.
- Agents may suggest tests when they would protect critical behavior.
- Present the proposed scope, cases, and test type before requesting approval.
- Run existing relevant tests after implementation changes without requiring approval.
- Write test stories, cases, and descriptions in assertive language.
- Describe the behavior a passing test guarantees.
- Write user stories as:
  - `As a <role>, I can <action> to <result>.`

### Tests structure

- Co-locate unit tests with the source module they exercise.

- Define each test with:
  1. A story or description.
  2. The behavior being tested.
  3. Passing and failing cases.
- Prefer the smallest test type that proves the behavior.
- Test observable behavior through public interfaces.
- Do not test implementation details.
- Keep tests deterministic, isolated, and repeatable.
- Give each test one clear reason to fail.
- Do not duplicate the same assertion across test types.

#### Data for input and seeding

- Use input data for values supplied during the tested action.
- Use seed data for state created by earlier or unrelated processes.
- Share input and seed files across tests in the same domain.
- Use predictable values and never store secrets.
- Remove records created by a test, including after failures.
- Never change or remove data the test did not create.

#### Folder structure

```text
src/
└─ .../<domain>/
    ├─ ...
    ├─ <domain>.test.ts
    ├─ <domain>.test.input.json
    └─ <domain>.test.seed.json
```

### Writing tests

1. Name the test file according to what it tests, using a short descriptive filename.
2. Discover the passing, failing, invalid, empty, and boundary cases that matter.
3. Define the observable result for each case.
4. Write the story as JSDoc, for the corresponding group of tests for the flow.
5. Use assertive language to write:
   1. The description of the group, using the result and role.
   2. The description of each test from the action.

```ts
// <domain>/<filename>.test.ts

/** As a [role], I want to [action], to [result] */
describe(`to [result] as a [role], I...`, () => {
  test(`can [passing-action]`, () => {})
  test(`can't [failing-action]`, () => {})
  ...
})
```

### End-to-end tests

- Use Playwright.
- Assert outcomes visible to the user.
- Validate complete user flows through the browser.
- Validate:
  - Layout and visible state.
  - User interaction.
  - Route changes.
  - Application integrations.
  - Successful outcomes.
  - Expected failures.
- Seed only the state required by the story.
- Keep input and seed data at the nearest shared story scope.
- Use Playwright test agents to plan, generate, and repair tests.
- Do not use a test repair to hide a product defect.

When writing tests with Playwright, always review these tools and choose the most convenient one:

- [Playwright CLI](http://playwright.dev/agent-cli/introduction)
- [playwright mcp server](https://playwright.dev/mcp/introduction)
- [playwright agents](https://playwright.dev/docs/test-agents)

### Unit tests

- Use unit tests for critical code in isolation.
- Give each unit test group a concise behavior description.
- Test critical:
  - Authentication and authorization.
  - Permissions.
  - Monetary calculations.
  - Data integrity.
  - Destructive actions.
  - State transitions.
  - Parsing and normalization.
  - Error translation.
- Do not unit test:
  - Framework behavior.
  - Generated code.
  - Static configuration.
  - Thin wrappers or adapters.
  - Trivial CRUD behavior.
  - Constants or type-only code.
- Use static input and seed data for provider-independent logic.
- Do not use fixtures, stubs, or mocks to imitate third-party services.
- Test third-party integrations against the real service in a separate integration suite.
- Use provider test modes, sandboxes, or dedicated test accounts.
- Skip provider tests when required credentials are unavailable.
- Never fall back to mocked provider behavior.

### Component tests

- Test components through Storybook stories.
- Use the story, tests, and cases structure.
- Prefer testing atoms and molecules.
- Test larger components only when their owned behavior cannot be proven at a smaller level.
- Do not test organisms, templates, or pages only to confirm that React or Next.js renders them.
- Use render-only stories for static visual states.
- Add Storybook interaction tests only for meaningful interaction.
- Validate:
  - Visual states.
  - User interaction.
  - Keyboard behavior.
  - Accessible names, roles, and states.
  - Relevant layout changes.
- Keep stories deterministic, isolated, and safe to rerun.
- Do not depend on mutable external state.
- Use Storybook args for component states and cases.
- Keep stories beside their component.

### Verification

- Run only the suites relevant to the changed or approved tests.
- Run integration tests only when provider credentials are available.
- Report product defects separately from test defects.
- Report provider outages and rate limits separately from product failures.
- Do not weaken assertions to make a failing test pass.
