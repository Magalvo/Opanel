# WS-085 — Absent-link assertions are scoped to their navigation

- Status: Done (2026-11-19)
- Work-item: [WI-085](../work-items/WI-085-nav-link-assertion-scope.md)
- Canonical docs: none (test-only); see WI-084 for the same fix on the Agents link

## Approach

Playwright's `getByRole(role, { name })` matches `name` as a case-insensitive substring
unless `exact: true` is given, and `page.getByRole` searches the whole page. A
`toHaveCount(0)` built that way fails as soon as any other link on the page contains the
word, for example a project called "People ops" on `/` or a task called "Settings page" on
a board.

Each assertion is scoped to the navigation that renders the link, and matches exactly:

1. `tests/e2e/people.spec.ts:144` (Member on `/`). The People link is rendered only inside
   `<nav aria-label="Main">` (`src/components/app-shell/app-sidebar.tsx:35`, guarded by
   `canManageAccounts`). New code:

   ```ts
   const nav = page.getByRole("navigation", { name: "Main" });
   await expectSigned(nav.getByRole("link", { name: "Projects", exact: true })).toBeVisible();
   await expectSigned(nav.getByRole("link", { name: "People", exact: true })).toHaveCount(0);
   ```

2. `tests/e2e/projects.spec.ts:133` (Viewer on a project page). The Settings link is
   rendered only inside `<nav aria-label="Project">`
   (`src/components/projects/project-frame.tsx:140`, guarded by `canManageProjects`); line 53
   of the same spec already locates the link there. New code:

   ```ts
   const projectNav = page.getByRole("navigation", { name: "Project" });
   await expect(projectNav.getByRole("link", { name: "Board", exact: true })).toBeVisible();
   await expect(projectNav.getByRole("link", { name: "Settings", exact: true })).toHaveCount(0);
   ```

The positive assertion on a sibling link in the same navigation (Projects, Board) keeps the
negative one from passing vacuously if the navigation were renamed or not rendered: a scoped
`toHaveCount(0)` on a missing container would otherwise always pass.

## Files

| Path                             | Change                                 |
| -------------------------------- | -------------------------------------- |
| `tests/e2e/people.spec.ts`       | modify: scope the People assertion     |
| `tests/e2e/projects.spec.ts`     | modify: scope the Settings assertion   |
| `docs/README.md`, WI-085, WS-085 | modify: index row, statuses, follow-up |

No application code, no new dependency, no migration.

## Data model changes

None.

## API contract

None.

## Test plan (written first, in this order)

The change is to tests, so "red" is shown with a throwaway probe that is not committed:
before the change, with a project whose name contains "People" visible to the Member on
`/` (or a task containing "Settings" on the Viewer's board), the old assertion fails; after
it, the new one passes against the same data.

| #   | Level | Test                                                                                                                        | Covers criterion |
| --- | ----- | --------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | e2e   | `people.spec.ts` "a Member does not see People…", scoped to `Main`, exact                                                   | 1, 3             |
| 2   | e2e   | `projects.spec.ts` Viewer test, scoped to `Project`, exact                                                                  | 2, 3             |
| 3   | gate  | `pnpm test:e2e tests/e2e/people.spec.ts tests/e2e/projects.spec.ts --retries=0 --repeat-each=3`, then the full quality gate | 3                |

## Risks and open questions

1. WI-084 and its README follow-up, which this item builds on, are not on `main` or on any
   pushed branch as of 2026-11-19. This item takes the number after it so as not to collide.
   On completion it removes the README follow-up entry that names these two assertions, if
   that entry has landed by then; otherwise there is nothing to remove. Owner: confirm.

## Implementation record

- Red, with a throwaway probe spec (deleted, not committed): a Viewer's board holding a
  task titled "Settings page" made the old assertion fail (expected 0, received 1, the
  task card). On `/`, which shows no user data today, a link "People ops" injected into
  `main` was matched by the old People locator. Green: the scoped, exact assertions passed
  on the same pages.
- `pnpm test:e2e tests/e2e/people.spec.ts tests/e2e/projects.spec.ts --retries=0
--repeat-each=3`: 26 of 26.
- Gate on 2026-11-19:
  - typecheck, lint and Prettier pass;
  - Vitest 1546 of 1546;
  - `pnpm test:e2e` 87 of 87 with `--retries=0` on the second run. The first run failed
    one test, `agents.spec.ts:136` ("a Manager has neither the Agents link nor the page"),
    which found the projects "Agents …" that another spec creates: the WI-084 defect,
    outside this item and left for it;
  - Linux, Node, PostgreSQL 16 on port 5432 (no Docker in this session; the compose file's
    roles and databases created by hand).

## Deviations

- Risk 1: WI-084 landed on `main` while this item was in review. Merging `main` brought its
  README follow-up entry naming these two assertions, which this item then removed, and
  its fix for `agents.spec.ts:136`, the failure in the first gate run above.
