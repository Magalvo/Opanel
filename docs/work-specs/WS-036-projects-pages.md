# WS-036 — Projects list, navigation and project settings

- Status: Done (approved by the owner on 2026-11-16, questions 1 to 5 as proposed)
- Work-item: [WI-036](../work-items/WI-036-projects-pages.md)
- Canonical docs: [0003](../canonical/0003-task-management.md) sections 2, 3 and 5;
  [0004](../canonical/0004-api-conventions.md) sections 4, 5 and 6;
  [WT-03](../work-tracks/WT-03-board-core.md) decisions 2, 4, 5, 7, 10, 11, 12 and question 3;
  [WS-028](WS-028-projects-and-default-columns.md), [WS-029](WS-029-columns-api.md),
  [WS-032](WS-032-delete-and-restore-task.md) (the APIs); [WS-035](WS-035-teams-page.md)
  (the pattern these pages follow)

## Approach

### 1. Routes and access

| URL                      | Who                                  | What                                        |
| ------------------------ | ------------------------------------ | ------------------------------------------- |
| `/projects`              | everyone signed in (`projects:read`) | the list; "New project" for managers        |
| `/projects/KEY`          | everyone signed in                   | the project: header, navigation, board area |
| `/projects/KEY/settings` | `projects:manage` (Manager, Admin)   | details, columns, deleted tasks             |

- **URLs use the project key** (`/projects/OPA`), as WT-03 question 3 does for tasks
  (`/projects/OPA/tasks/OPA-12`). A path segment that is not a valid key
  (`projectKeySchema`) is `notFound()` on the server; a key the API answers `404` for shows
  "This project does not exist." with a link to `/projects`.
- **Settings are for Managers and Admins.** Everyone else gets `notFound()`, as the People
  page does for non-Admins (WS-020), and sees no "Settings" link. Restoring deleted tasks
  needs `tasks:delete_any`, which the same two roles have; the section is shown on that
  permission, not assumed.
- Server components call `requireAccount()` and pass booleans (`canManageProjects`,
  `canRestoreTasks`) to client components; the data is read by the browser through the
  API, which stays the guard.

### 2. Sidebar

"Projects" (`/projects`, `FolderKanbanIcon`) becomes the first link, for everyone, above
Teams and People.

### 3. `/projects`

- A `<table>`: name (a link to `/projects/KEY`) and key. Ordered by name, as the API returns
  them; "Load more" while `nextCursor` is not null.
- Two views as a toggle group: **Active** (default, `GET /api/v1/projects`) and
  **Archived** (`?archived=true`). The view is kept in the URL (`?view=archived`), so it
  survives a reload.
- Empty states: "No projects yet." / "No archived projects."
- **New project** (managers): a dialog with key, name and description. The key field turns
  what is typed into upper case, and says "2 to 10 letters and digits, starting with a
  letter. It never changes." Validated with `createProjectRequestSchema`;
  `409 project_key_taken` is shown at the key field. On `201` the browser goes to
  `/projects/KEY`.

### 4. `/projects/KEY` (question 1)

A layout (`src/app/(app)/projects/[projectKey]/layout.tsx`) renders, for every page under
the project:

- the header: name, key, and an "Archived" badge while `archivedAt` is set;
- the project navigation: **Board** (`/projects/KEY`) and, for managers, **Settings**
  (`/projects/KEY/settings`); WI-039 adds Epics.

The board page itself (`page.tsx`) shows, until WI-037, the text "The board comes in the
next update." in the board area. WI-037 replaces the page, not the layout.

### 5. `/projects/KEY/settings`

Three sections, each a `<section>` with a heading, on one page:

**Details**

- Name and description (a plain `<textarea>`; Markdown is stored as written and rendered
  with WI-038, decision 14). "Save" sends `PATCH` with the `version` the form was loaded
  with.
- `409 version_conflict`: the form is refilled from `current` and the message says
  "Someone else changed this project. Their version is shown; make your change again."
- **Archive** (after a confirmation: "Archive OPA? Everything in it becomes read-only until
  it is unarchived.") and **Unarchive** (no confirmation).
- While archived, every field and button of the page is disabled except Unarchive, and a
  line says why.

**Columns**

- A list in board order: name, category (To do, In progress, Done) and, per row, Edit,
  Move up, Move down, Delete. The first row has no Move up and the last no Move down.
- **Add column**: a dialog with name and category (default To do); added at the end.
- **Edit**: a dialog with name and category; `PATCH` with the row's `version`.
- **Move up / Move down**: `POST /api/v1/columns/{id}/move` with the `afterColumnId` that
  puts it one place earlier or later (`null` for first) and its `version`. Keyboard focus
  stays on the moved row's button.
- **Delete**: after a confirmation naming the column.
- After every change the list is re-read from the API (it is small and returned whole,
  decision 10), so positions and versions are always current.
- Messages, by problem code: `last_done_column` "A project needs at least one Done column.";
  `column_not_empty` "Move or delete its tasks first."; `version_conflict` "Someone else
  changed the columns. The list was refreshed."; `project_archived` "The project is
  archived."

**Deleted tasks** (shown with `canRestoreTasks`)

- `GET /api/v1/projects/KEY/tasks?deleted=true`, paginated: key, title and deletion time
  (local time, formatted after load, as on People). Empty: "No deleted tasks."
- **Restore** (no confirmation, it is undoable): `POST /api/v1/tasks/{id}/restore`; the row
  leaves and the message says "OPA-12 was restored to its column."

One status region (`role="status"`) per page announces every outcome.

### 6. Shared pieces

- `src/components/projects/api.ts` uses the client of `src/lib/api-client.ts` (WS-035) and
  the shared schemas of `projects.ts`, `columns.ts`, `tasks.ts` and `problem.ts`.
- Built from the existing `src/components/ui/` pieces. A new **`textarea`** component, in
  the same hand-written shadcn style as `input.tsx`, is the only addition. **No new
  dependency.**
- Destructive actions use the `outline` style for the button that opens the confirmation,
  because of the contrast follow-up recorded in WI-035.

### 7. The delete-column contract (question 3)

`DELETE /api/v1/columns/{columnId}` answers `409 column_not_empty` when a task is in the
column (WI-030), but `deleteColumnContract` only names `last_done_column` and
`project_archived`. Under hard rule 11 this is raised here: the proposal is to add
`column_not_empty` to that response's description and regenerate the OpenAPI document.
Documentation of existing behaviour only, no new API version.

### 8. Out of scope

The board, drag and drop and creating tasks (WI-037); the epics page (WI-039); the task
page (WI-038); live updates (WT-04); the project's fallback triage team (WT-06); rendering
the description as Markdown (WI-038 adds the renderer).

## Files

| Path                                                                                                    | Change                               |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `src/app/(app)/projects/page.tsx` (+ integration test)                                                  | create (tests first)                 |
| `src/app/(app)/projects/[projectKey]/layout.tsx`, `page.tsx`, `settings/page.tsx` (+ integration tests) | create (tests first)                 |
| `src/components/projects/*.tsx`, `api.ts` (+ `*.test.tsx`)                                              | create (tests first)                 |
| `src/components/ui/textarea.tsx`                                                                        | create                               |
| `src/components/app-shell/app-sidebar.tsx`, `app-shell.test.tsx`                                        | modify: the Projects link            |
| `src/lib/schemas/columns.ts` (+ test)                                                                   | modify: `column_not_empty` on delete |
| `docs/api/openapi.json`                                                                                 | regenerate                           |
| `tests/e2e/projects.spec.ts`; `tests/e2e/accessibility.spec.ts`                                         | create; modify                       |
| `docs/README.md`, WT-03, WI-036, WS-036                                                                 | modify: statuses (and question 4)    |

No migration, no new endpoint, no new dependency.

## Data model changes

None.

## API contract

No new operation. One description extended (section 7). The pages use the project, column
and task endpoints of WS-028, WS-029, WS-030 and WS-032.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                                              | Covers criterion |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit        | contract: delete-column `409` names `column_not_empty`; the OpenAPI document lists it                                                                                                             | contract         |
| 2   | unit        | sidebar: Projects is the first link, for everyone, to `/projects`                                                                                                                                 | sidebar          |
| 3   | integration | `/projects` and `/projects/KEY` render for every role with the right booleans; settings render for Manager and Admin and are not-found for Member and Viewer; an invalid key segment is not-found | access           |
| 4   | unit        | projects list: loading, rows with link and key, empty states, Retry, Load more, the Active / Archived toggle reading and writing `?view=archived`                                                 | list             |
| 5   | unit        | new project: upper-cases the key, browser validation, `409 project_key_taken` at the key field, success goes to `/projects/KEY`; no button when read-only                                         | create           |
| 6   | unit        | project header: name, key, Archived badge, Settings link only for managers; `404` shows "This project does not exist."                                                                            | header           |
| 7   | unit        | details: saves with `version`; `409 version_conflict` refills from `current` and explains; archive asks first, unarchive does not; archived disables everything but Unarchive                     | details          |
| 8   | unit        | columns: board order; add; edit; move up and down send the right `afterColumnId` (`null` for first) and `version`; no Move up on the first row nor Move down on the last; delete asks first       | columns          |
| 9   | unit        | columns: each of `last_done_column`, `column_not_empty`, `version_conflict`, `project_archived` gives its message, and the list is re-read                                                        | columns          |
| 10  | unit        | deleted tasks: list with key, title, time; restore removes the row and announces it; hidden without `canRestoreTasks`                                                                             | restore          |
| 11  | unit        | every control has an accessible name; outcomes are announced; Escape closes dialogs and returns focus                                                                                             | accessibility    |
| 12  | e2e         | a Manager creates a project, finds it in the list, edits its details, adds, renames, moves and deletes a column, cannot delete the last Done column, archives and unarchives it                   | end to end       |
| 13  | e2e         | a task deleted through the API is restored from settings and is listed again by the API                                                                                                           | restore          |
| 14  | e2e         | a Viewer sees Projects and the project page, no New project and no Settings link, and gets the not-found page at `/projects/KEY/settings`                                                         | access           |
| 15  | e2e         | axe finds no violations on the list and the settings page in light and dark mode; at phone width there is no horizontal page scroll                                                               | accessibility    |
| 16  | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; `pnpm openapi:generate` leaves no diff after the change of section 7                                                                     | gate             |

## Risks and open questions

For the owner:

1. **`/projects/KEY` before the board exists.** Proposed: the project's header and
   navigation now, with "The board comes in the next update." in the board area, so the
   list has somewhere to link and WI-037 only replaces the page. The alternative is to link
   the list to the settings page until WI-037. **Recommend: as proposed.**
2. **Settings are for Managers and Admins only**, with a not-found page for the others, as
   People is for Admins. The alternative is a read-only settings page for everyone.
   **Recommend: managers only.**
3. **`column_not_empty` is documented here** (section 7), as `team_in_use` was in WI-035.
   **Recommend: yes.**
4. **A wider contract gap, not fixed here.** On every `PATCH` and move that checks
   `version` (projects, columns, tasks, epics), the documented `409` schema requires
   `code: "version_conflict"` and `current`, but those operations also answer other `409`
   problems: `project_archived` everywhere, and `last_done_column` on a column `PATCH`.
   Those answers do not match the documented schema. Fixing it means changing how
   `versionConflictResponse` is turned into OpenAPI (for example "a version conflict, or
   another problem") across those operations. It is a contract change of its own, so I
   propose recording it as a follow-up in `docs/README.md` and giving it its own
   work-item, rather than folding it into this UI item. These pages read `code` either
   way. **Owner: agree?**
5. **Reordering columns with Move up / Move down buttons**, not drag and drop. Drag and drop
   arrives with the board (WI-037, `@dnd-kit`); buttons are simpler, work by keyboard and
   need no dependency here. **Recommend: buttons.**

Technical, settled by the tests:

6. **Concurrent column edits.** Each change sends the row's `version`; after any change or
   conflict the list is read again, so a stale order is never kept.
7. **Deleted tasks of an archived project** can still be listed but not restored
   (`project_archived`); the Restore buttons are disabled there, as every other write.

## Deviations from the approved spec

- **The settings page's not-found answer has status 200, not 404.** For a Member or Viewer,
  `/projects/KEY/settings` shows Next.js's not-found page, as specified, but the HTTP
  status stays 200 with a `noindex` tag. The page is rendered as a child of the project's
  client frame, so the response has already started streaming when it calls `notFound()`;
  the installed Next.js docs describe this case (`not-found.md`, "Status codes"). The
  end-to-end test, written first, asked for a 404 status; it now checks the not-found page
  and the `noindex` tag, which is what the criterion asks. The People page, which has no
  layout in between, still answers 404.
- **The project is loaded once by the frame and shared through a context**
  (`useProject`), so the header (name, Archived badge) follows changes made in settings.
- **The category field is a native `<select>`**, styled like the other fields, rather than
  the Radix `select`: simpler to operate by keyboard and in tests. Still no new component
  beyond `textarea`.
- **`ApiFailure` keeps the whole problem body** (`body`), so a `409 version_conflict` can
  refill the form from `current`. The People and Teams pages are unchanged.
- **The fake `fetch` of the Teams tests moved** to `src/components/fake-api.ts`, shared by
  the Teams and Projects tests.
- **The two project tabs are written as two `Link`s**, not a list, so typed routes check
  both `href`s without a cast.
- **Section regions:** each settings section is a `<section>` labelled by its heading, so
  tests and assistive technology find them as regions.

## Implementation record

- Red: the contract, sidebar, page, component and end-to-end tests failed on the missing
  description, link and modules (committed before any code).
- Two test fixtures of mine were wrong after Red and were fixed, not the code: a restored
  task was a `TaskSummary` where the API returns a `Task`, and one assertion was never
  called (`.toBeVisible` without `()`).
- `next build`, which the end-to-end tests run, rejected a list of `href`s typed as
  `string` (typed routes); see the tabs deviation above.
- Green: 813 Vitest tests (up from 762) and 40 Playwright tests (up from 34) pass.
  Typecheck, lint and format pass; `pnpm db:generate` leaves no diff and
  `pnpm openapi:generate` adds only the description of section 7.
- Question 4's contract gap is recorded as a follow-up in `docs/README.md`.
- Locally the database was PostgreSQL 16 (no Docker in the sandbox); CI runs the
  PostgreSQL 18 of `compose.yaml`.
