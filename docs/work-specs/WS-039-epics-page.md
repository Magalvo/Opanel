# WS-039 — Epics page

- Status: Proposed (must be `Approved` by the owner before any code is written)
- Work-item: [WI-039](../work-items/WI-039-epics-page.md)
- Canonical docs: [0003](../canonical/0003-task-management.md) sections 3 and 4;
  [0004](../canonical/0004-api-conventions.md) sections 4, 5, 6, 7;
  [WS-033](WS-033-epics.md), [WS-036](WS-036-projects-pages.md), [WS-038](WS-038-task-detail.md);
  [WT-03](../work-tracks/WT-03-board-core.md) decision 18; `AGENTS.md` hard rules 4 and 6

## Approach

No API change: the page is a client of the four epic operations of WS-033 and of nothing else.
Like the People, Teams and Projects pages, it is client components that call the API with
`fetch` and parse each answer with the shared schemas.

### 1. Route and access

`src/app/(app)/projects/[projectKey]/epics/page.tsx`, a server component. It calls
`requireAccount()`, loads the project with `loadProject` (an unknown or malformed key is the
not-found page, as for the other project pages) and passes the project and two booleans to the
screen: `canManage` (`epics:manage`, Manager and Admin) and `archived`. Everyone signed in may
read; the API enforces `epics:manage` on every write.

The project page (`ProjectHeader`) gets an **"Epics" link**, for every role, next to Settings.
There is no sidebar item: the sidebar has no per-project navigation yet, and adding one is a
decision for the track that brings backlog and sprints.

The route sits under `[projectKey]`, so the `@modal` slot of WS-038 already has its catch-all
and the task dialog closes when someone navigates here.

### 2. The screen (`src/components/epics/`)

- **`EpicsPage`** holds the list, `nextCursor`, the phase (loading, error, ready), a `Show`
  select (Open, Closed, All, mapped to the API's `status`; default Open) and one
  `role="status"` region, named "Epic messages". A "New epic" button for `canManage` when the
  project is not archived. Changing the select loads from the first page again.
- **`EpicsTable`**: a real `<table>` inside a scroll container: title (a button that opens the
  epic), status badge, start and target dates (shown as `YYYY-MM-DD`, "—" when null), and
  progress. At phone width the table scrolls inside its container.
- **`ProgressBar`**: `role="progressbar"` with `aria-valuemin` 0, `aria-valuemax` the total,
  `aria-valuenow` the done tasks and an accessible name ("Progress of Auth: 2 of 5 tasks
  done"); the text "2 / 5" is drawn next to it. An epic with no tasks says "No tasks". The bar
  never relies on colour alone.
- **`EpicDialog`**: opens on an epic. For someone who may not change it, the title, dates and
  the description as Markdown (`Markdown` of WS-038). For `canManage` on a writable project, a
  form: Title, Description (`MarkdownEditor` of WS-038, with Write and Preview), Start date and
  Target date (`<input type="date">`), and "Save changes", which sends only what changed with
  the `version`; and a "Close epic" or "Reopen epic" button.
  - `409 version_conflict` replaces the form with `current` and says so, as for projects and
    tasks. A target date before the start date is refused in the browser and, if it gets to
    the API, shown next to the field from the `400`.
  - **Closing** an epic that has tasks not done opens an alert dialog: "This epic still has 3
    tasks that are not done. Close it anyway?" (the API allows it, question 3). With none, it
    closes at once.
  - The dialog keeps its own `role="status"`; the page's list is updated from every response
    (title, dates, status, progress).
- **`CreateEpicDialog`**: Title, Description, two dates; validated with
  `createEpicRequestSchema`; a `400` shows its field errors; on `201` the dialog closes, the
  epic is added to the list when the list shows open epics, and the page's status says so.
- **Archived project:** the create button and every control of the epic dialog are absent and a
  line says "This project is archived, so its epics are read-only."; `409 project_archived`
  from the API does the same.
- **Load more** while `nextCursor` is not null.

The `MarkdownEditor` currently lives in `src/components/task/`. It moves to
`src/components/markdown-editor.tsx`, beside `Markdown`, with its test, since two features use
it; the task components import it from there. No behaviour changes.

### 3. Out of scope

The epic's tasks and filtering or grouping the board by epic (WT-08); epic start and target
dates driving anything (they are shown); story points (WT-10); deleting an epic (never).

## Files

| Path                                                                      | Change                                        |
| ------------------------------------------------------------------------- | --------------------------------------------- |
| `src/app/(app)/projects/[projectKey]/epics/page.tsx` (+ integration test) | create (tests first)                          |
| `src/components/epics/*.tsx`, `api.ts` and `*.test.tsx`                   | create (tests first)                          |
| `src/components/markdown-editor.tsx`                                      | move from `components/task/`, with its test   |
| `src/components/task/*`                                                   | modify: import the editor from its new place  |
| `src/components/projects/project-header.tsx` (+ test)                     | modify: the "Epics" link                      |
| `tests/e2e/epics.spec.ts`                                                 | create                                        |
| `docs/README.md`, WT-03, WI-039, WS-039                                   | modify: statuses; WT-03 exit criteria checked |

No new dependency, no migration, no API change.

## Data model changes

None.

## API contract

None. The page uses `GET` and `POST /api/v1/projects/{projectId}/epics` and `GET` and `PATCH
/api/v1/epics/{epicId}`.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                                                  | Criterion      |
| --- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 1   | unit        | `ProjectHeader`: an Epics link to `/projects/KEY/epics` for every role, beside Settings for a Manager                                                                                                 | link           |
| 2   | integration | the page: renders for every role with `canManage` true only for Manager and Admin and `archived` passed; an unknown or malformed project key is not found; no session redirects                       | access         |
| 3   | unit        | `EpicsPage`: loading, rows with title, status, dates ("—" for none) and progress; error and Retry; "Load more"; an empty message for each filter                                                      | list           |
| 4   | unit        | the Show select loads Open by default, then Closed and All from the first page with `status=`                                                                                                         | filter         |
| 5   | unit        | `ProgressBar`: a progressbar role with the done and total, a name that says "2 of 5 tasks done", "No tasks" for an epic with none, and the numbers as text                                            | progress       |
| 6   | unit        | opening an epic as a reader shows the description rendered as Markdown (a `<script>` in it is not run) and no form, button or date input                                                              | read only      |
| 7   | unit        | create: validates title and dates in the browser, posts `{ title, description?, startDate?, targetDate? }`, adds the row to an Open list and not to a Closed one; field errors from a `400` are shown | create         |
| 8   | unit        | a target date before the start date is refused in the browser, next to the field                                                                                                                      | dates          |
| 9   | unit        | edit: sends only what changed with the `version`, uses the new version next time, updates the row (title, dates, progress); Save is disabled until something changes                                  | edit           |
| 10  | unit        | `409 version_conflict` shows the `current` epic and the message; `project_archived` makes the page read-only and says why                                                                             | conflicts      |
| 11  | unit        | close and reopen send `{ status, version }`; closing an epic with tasks not done asks first, says how many, and cancelling changes nothing; one with none closes at once                              | close, reopen  |
| 12  | unit        | an archived project and a Viewer or Member show no create, edit, close or reopen control                                                                                                              | read only      |
| 13  | unit        | the `MarkdownEditor` tests still pass from their new place; the task components still work                                                                                                            | no regression  |
| 14  | unit        | accessibility: one announced region, a headed table, named controls, Escape closes dialogs and returns focus                                                                                          | accessibility  |
| 15  | e2e         | a Manager creates an epic, edits it, creates tasks in it through the API, sees the progress, moves a task to Done and reloads to see it counted, closes and reopens the epic                          | end to end     |
| 16  | e2e         | a Member opens the Epics link from a project, sees the epics and a description rendered, and no controls; a closed epic appears only under Closed and All                                             | access, filter |
| 17  | e2e         | at phone width no sideways scroll, dark theme, no axe violations on the page and on the dialog                                                                                                        | responsive     |
| 18  | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; `pnpm openapi:generate` leaves no diff                                                                                                       | gate           |

When this item is done, the exit criteria of WT-03 are checked one by one against the running
application, and the track is closed in the same commit (question 6).

## Risks and open questions

For the owner:

1. **The epics page is reached from a link on the project page**, not from the sidebar, which
   has no per-project items. Agree?
2. **Open epics by default, with a Show select** for Closed and All, matching the API's
   default. Agree?
3. **Closing an epic with tasks that are not done asks first** and says how many, though the
   API allows it. The alternative is to close at once. Agree?
4. **Descriptions only in the dialog**, not in the list, which stays a scannable table.
   Agree?
5. **`MarkdownEditor` moves to `src/components/`**, beside `Markdown`, now that two features use
   it. A move, no change. Agree?
6. **Closing WT-03 in this item.** Once the page exists, the 10 exit criteria of the track are
   checked against the running application and the track is marked Done, with a note of
   what was verified. Agree that this belongs to WI-039 rather than to a separate item?
