# WS-084 — The Manager's Agents-link check looks only at the sidebar

- Status: Proposed (must be `Approved` by the owner before any code is written)
- Work-item: [WI-084](../work-items/WI-084-agents-link-assertion-scope.md)
- Canonical docs: none (test-only change; [WS-077](WS-077-agents-page.md) test 10 is the test
  being fixed)

## Approach

Scope the negative assertion to the sidebar's `<nav aria-label="Main">`
(`src/components/app-shell/app-sidebar.tsx`) and match the link name exactly:

```ts
await expect(
  page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Agents", exact: true }),
).toHaveCount(0);
```

This is the same locator the line above uses for "Projects", plus `exact: true`. The test is
about the sidebar link that only Admins get (`canManageAgents`). Project links in the page
body are not part of what it checks.

The Admin test's wait at `tests/e2e/agents.spec.ts:69` is already scoped to the Main
navigation. It gets `exact: true` too. It passes today because no other sidebar link contains
"agents", but with `exact` a later sidebar item cannot make it match the wrong link. No other
`"Agents"` link locator exists in `tests/e2e/`. `accessibility.spec.ts:180` looks for a
heading, not a link.

This is not a change to the product. The test data stays as it is (`Agents <KEY>` projects),
because those project names are what reproduce the bug.

## Files

| Path                       | Change                                                     |
| -------------------------- | ---------------------------------------------------------- |
| `tests/e2e/agents.spec.ts` | modify: scope and `exact` on the two Agents-link locators  |
| `docs/work-items/WI-084-…` | modify: status                                             |
| `docs/work-specs/WS-084-…` | modify: status                                             |
| `docs/README.md`           | modify: index rows, "Where the project stands", follow-ups |

## Data model changes

None.

## API contract

None.

## Test plan (written first, in this order)

The test already exists and is already red, so the Red step is to reproduce the failure
before changing it.

| #   | Level | Test                                                                                                                                                                                                                                                                | Covers criterion |
| --- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | e2e   | Red: on a fresh end-to-end database, `pnpm test:e2e tests/e2e/agents.spec.ts --retries=0 --repeat-each=3` fails "a Manager has neither the Agents link nor the page" with `Received: 2` (or more) once `Agents <KEY>` projects are on the first page of `/projects` | 1, 2             |
| 2   | e2e   | Green: the same command passes after the change, every repetition                                                                                                                                                                                                   | 1, 2             |
| 3   | —     | `grep -rn 'name: "Agents"' tests/e2e/` shows only Main-navigation-scoped, `exact` link locators                                                                                                                                                                     | 3                |
| 4   | gate  | `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm test:e2e`                                                                                                                                                                                    | 4                |

## Risks and open questions

- If the Red step does not reproduce on a fresh database (worker order), the run is repeated
  after the Admin test has created its projects. The record of 2026-11-19 (3 of 3 failures)
  stands as the evidence either way.
- Follow-up, not in this item: `people.spec.ts:144` and `projects.spec.ts:133` have the same
  unscoped pattern and could break the same way if test data ever contains "People" or
  "Settings".
