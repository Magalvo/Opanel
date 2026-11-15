# WS-036 — Projects list, navigation and project settings

- Status: Approved (by the owner on 2026-11-15, with the proposals of questions 1 to 6)
- Work-item: [WI-036](../work-items/WI-036-projects-pages.md)
- Canonical docs: [0003](../canonical/0003-task-management.md) sections 2, 3, 5;
  [0004](../canonical/0004-api-conventions.md) sections 4, 5, 6, 7;
  [WS-028](WS-028-projects-and-default-columns.md), [WS-029](WS-029-columns-api.md),
  [WS-032](WS-032-delete-and-restore-task.md), [WS-020](WS-020-people-page.md);
  [WT-03](../work-tracks/WT-03-board-core.md) decisions 2, 4, 10, 12; `AGENTS.md` hard rules
  4 and 6, section 3

## Approach

No API change: the pages are clients of the endpoints that exist. Like the People and Teams
pages, the components are client components that call the API with `fetch` and parse each
response with the shared schemas.

### 1. Routes and access

| Route                             | Who                                   | Content                                                 |
| --------------------------------- | ------------------------------------- | ------------------------------------------------------- |
| `/projects`                       | every signed-in person                | the projects list, "New project" for a Manager or Admin |
| `/projects/[projectKey]`          | every signed-in person                | the project's header; WI-037 adds the board             |
| `/projects/[projectKey]/settings` | Manager and Admin (`projects:manage`) | details, archive, columns, deleted tasks                |

Each page is a server component that calls `requireAccount()`. The settings page gives
`notFound()` to anyone without `projects:manage`, so it does not confirm that it exists, as
the People page does. An unknown key is `notFound()` too: the page reads the project with
`GET /api/v1/projects/{key}` and treats `404` as not found. The API stays the guard for
every read and write.

The sidebar gets a "Projects" link (`FolderKanbanIcon`) for every role, above Teams. It is
the same `AppSidebar` change WI-035 made, so this item is built after WI-035 or rebased on it.

### 2. The projects list (`src/components/projects/`)

- **`ProjectsPage`**: heading, a `role="status"` region, a "Show archived" switch and, if
  `canManage`, a "New project" button. It loads `GET /api/v1/projects?limit=50` and, with the
  switch on, `...&archived=true`; turning the switch re-loads from the first page. States:
  loading placeholder, "Could not load projects." with Retry, an empty message, "Load more".
- **`ProjectsTable`**: a real `<table>`: key, name (a link to `/projects/KEY`), and an
  "Archived" badge when it is archived. At phone width it scrolls inside its container.
- **`CreateProjectDialog`**: key, name and description. The key field says "2 to 10
  uppercase letters and digits. It cannot be changed later." and upper-cases what is typed.
  Validated with `createProjectRequestSchema`; the server's field errors and
  `project_key_taken` ("This key is already used.") show next to the fields. On `201` the
  dialog closes and the list navigates to the new project's page.

### 3. The project page

`/projects/[projectKey]` shows the key, the name, an "Archived" badge, the description as
plain text and, for a Manager or Admin, a "Settings" link. Under it a short line says that
the board comes next. It is deliberately small: WI-037 replaces the body with the board and
keeps the header.

### 4. The settings page (`ProjectSettings`)

Four sections, one `role="status"` region at the top for outcomes.

- **Details.** Name and description (a textarea, plain text, up to 10 000 characters) with
  "Save", sending `PATCH /api/v1/projects/{id}` with the `version` the page holds. On `200`
  the page takes the new project. On `409 version_conflict` it replaces the form with the
  `current` project of the response and says "Someone else changed this project. Your edit
  was not saved; the current values are shown." The key is shown as text with its
  permanence explained.
- **Archive.** "Archive project" opens an alert dialog ("Archived projects are read-only.
  You can unarchive it later."); "Unarchive project" acts at once. In an archived project
  every control of the other sections is disabled and a line says why.
- **Columns.** The project's columns in board order (`GET .../columns`, never paginated),
  each with: a name field and a Rename button, a category select (To do, In progress, Done)
  that saves on change, "Move earlier" and "Move later" buttons, and a Delete button. "Move"
  calls `POST /api/v1/columns/{id}/move` with `afterColumnId` (the column before the new
  place, `null` for first). Delete asks first. Adding: name, category and an "Add column"
  button, appended at the end. Every write sends the column's `version`; a `409
version_conflict` reloads the list and says so. Messages: `column_not_empty` → "This
  column still has tasks. Move or delete them first."; `last_done_column` → "A project
  needs at least one Done column."
  There is **no drag and drop** here: the buttons are the whole interface, so no new
  dependency is added now (`@dnd-kit` arrives with the board, WI-037).
- **Deleted tasks.** Loaded when the section is opened: `GET .../tasks?deleted=true&limit=50`,
  listed as key, title and deletion time, with "Load more" and a "Restore" button per task
  (`POST /api/v1/tasks/{key}/restore`); the restored task leaves the list and the status
  region says so. A project with none says "No deleted tasks." For an archived project
  Restore is disabled; if the API still answers `409 project_archived`, the message says so.

### 5. UI components

No new component: `table`, `dialog`, `alert-dialog`, `select`, `badge`, `button`, `input` and
`skeleton` exist. The "Show archived" switch is a labelled checkbox; a `textarea` styled like
`input` is written by hand in `src/components/ui/`. No dependency.

### 6. Out of scope

The board, task creation, drag and drop, task detail (WI-037, WI-038); the epics page
(WI-039); editing a project's key; deleting a project (never, decision 4); Markdown rendering
of descriptions (WI-038).

## Files

| Path                                                             | Change                    |
| ---------------------------------------------------------------- | ------------------------- |
| `src/app/(app)/projects/page.tsx` (+ integration test)           | create (tests first)      |
| `src/app/(app)/projects/[projectKey]/page.tsx` (+ test)          | create                    |
| `src/app/(app)/projects/[projectKey]/settings/page.tsx` (+ test) | create                    |
| `src/components/projects/*.tsx`, `api.ts` and `*.test.tsx`       | create (tests first)      |
| `src/components/ui/textarea.tsx`                                 | create                    |
| `src/components/app-shell/app-sidebar.tsx` (+ test)              | modify: the Projects link |
| `tests/e2e/projects.spec.ts`                                     | create                    |
| `docs/README.md`, WT-03, WI-036, WS-036                          | modify: statuses          |

No new dependency, no migration, no API change, no OpenAPI change.

## Data model changes

None.

## API contract

None. The pages use `GET` and `POST /api/v1/projects`, `GET` and `PATCH
/api/v1/projects/{projectId}`, `POST .../archive` and `.../unarchive`, `GET` and `POST
/api/v1/projects/{projectId}/columns`, `PATCH`, `DELETE` and `POST .../move` on
`/api/v1/columns/{columnId}`, `GET /api/v1/projects/{projectId}/tasks?deleted=true` and
`POST /api/v1/tasks/{taskId}/restore`.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                                                                                                                                    | Criterion     |
| --- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| 1   | unit        | `AppSidebar`: a Projects link to `/projects` for every role, above Teams                                                                                                                                                                                                                | navigation    |
| 2   | integration | the three pages: `/projects` renders for every role and passes `canManage` only to Manager and Admin; the project page is `notFound` for an unknown key; settings is `notFound` for Member and Viewer and renders for Manager and Admin; each redirects to `/sign-in` without a session | access        |
| 3   | unit        | `ProjectsPage`: loading, rows with key, name link and Archived badge, error and Retry, empty message, "Load more"                                                                                                                                                                       | list          |
| 4   | unit        | the archived switch re-loads from the first page with `archived=true` and back                                                                                                                                                                                                          | archived      |
| 5   | unit        | `CreateProjectDialog`: upper-cases the key, says it is permanent, validates in the browser, posts `{ key, name, description }`, navigates to the new project; `project_key_taken` shown next to the key                                                                                 | create        |
| 6   | unit        | the project page shows key, name, description as plain text (a `<script>` in it is text), the Archived badge and a Settings link only for a Manager or Admin                                                                                                                            | project page  |
| 7   | unit        | details: saves with the held `version`; a `409 version_conflict` replaces the form with `current` and says so; the key is not an input                                                                                                                                                  | details       |
| 8   | unit        | archive asks first and then POSTs; unarchive POSTs at once; in an archived project the column, details and restore controls are disabled                                                                                                                                                | archive       |
| 9   | unit        | columns: add posts `{ name, category }`; rename and category PATCH with the column's `version`; a `409 version_conflict` reloads the list and says so                                                                                                                                   | columns       |
| 10  | unit        | move earlier and later post the right `afterColumnId` (`null` for first); the first column has no "Move earlier" and the last has no "Move later"                                                                                                                                       | columns       |
| 11  | unit        | delete asks first; `column_not_empty` and `last_done_column` show their plain-words messages and keep the column                                                                                                                                                                        | columns       |
| 12  | unit        | deleted tasks: loaded when opened, rows with key, title and time, "Load more", Restore removes the row and announces it; an empty project says "No deleted tasks."; `409 project_archived` is explained                                                                                 | deleted tasks |
| 13  | unit        | accessibility: one announced status region per page, headed tables, every control named, Escape closes dialogs and returns focus                                                                                                                                                        | accessibility |
| 14  | e2e         | a Manager creates a project, opens its settings, renames it, adds, renames, moves and deletes a column, archives and unarchives it                                                                                                                                                      | end to end    |
| 15  | e2e         | a task created and deleted through the API is listed under Deleted tasks and restored; a column that holds a task cannot be deleted and the page says why                                                                                                                               | rules         |
| 16  | e2e         | a Member sees the projects list and a project page without "New project" or "Settings", and gets the not-found page at `/projects/KEY/settings`                                                                                                                                         | access        |
| 17  | e2e         | at phone width no page scrolls sideways; the dark theme renders them; no axe violations on the list and on the settings page                                                                                                                                                            | responsive    |
| 18  | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; `pnpm openapi:generate` leaves no diff                                                                                                                                                                                         | gate          |

## Risks and open questions

For the owner:

1. **Settings are for Managers and Admins only.** Members and Viewers get the not-found page,
   because everything on it is an edit and they already see columns on the board. The
   alternative is a read-only settings page for everyone. Agree?
2. **A small project page now, the board in WI-037.** Without it the list would link to a
   page that does not exist. The alternative is to link straight to Settings until WI-037,
   which a Member could not use. Agree?
3. **Descriptions are plain text until WI-038** adds `react-markdown`. They are stored as
   Markdown and a script in one is shown as text, never run. Agree?
4. **Columns move with "earlier" and "later" buttons**, not drag and drop, which comes with the
   board's `@dnd-kit` in WI-037. It is fully keyboard-operable and needs no dependency.
   Agree?
5. **Archive and unarchive live in settings**, with a confirmation to archive, not on the
   list. Agree?
6. **A stale `version` discards the editor's change** (it is shown the current values and told),
   as the API does, instead of offering to merge. Agree?
