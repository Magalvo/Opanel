# WI-085 — Absent-link assertions are scoped to their navigation

- Status: Proposed
- Work-track: none: a test fix, the same pattern as WI-084
- Depends on: none
- Work-spec: [WS-085](../work-specs/WS-085-nav-link-assertion-scope.md)

## Outcome

Two end-to-end tests check that a navigation link is absent with
`page.getByRole("link", { name })`. Playwright matches `name` as a case-insensitive
substring across the whole page, so any project, task or team whose name contains the word
would make them fail, although the navigation is right:

- `tests/e2e/people.spec.ts:144`: a Member does not see the "People" link on `/`.
- `tests/e2e/projects.spec.ts:133`: a Viewer does not see the "Settings" link on a project
  page.

Each assertion looks only inside the navigation that would hold the link, and matches the
link's name exactly. Neither test fails today; this removes the dependency on other data in
the shared end-to-end database.

## Acceptance criteria

- [ ] `people.spec.ts` asserts the absence of "People" inside the `Main` navigation
      (`app-sidebar.tsx`), with `exact: true`, after asserting that the same navigation is
      visible.
- [ ] `projects.spec.ts` asserts the absence of "Settings" inside the `Project` navigation
      (`project-frame.tsx`), with `exact: true`, after asserting that the same navigation is
      visible.
- [ ] Both specs pass with `--retries=0 --repeat-each=3`, and the full quality gate passes.

## Notes

Test-only change: no application code, no API contract, no migration.
