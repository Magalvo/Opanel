# WS-039 — Epics page: list, create, edit, close, progress

- Status: Done (approved by the owner on 2026-11-16, questions 1 to 7 as proposed)
- Work-item: [WI-039](../work-items/WI-039-epics-page.md)
- Canonical docs: [0003](../canonical/0003-task-management.md) sections 3 and 4;
  [0004](../canonical/0004-api-conventions.md) sections 4 to 7;
  [WT-03](../work-tracks/WT-03-board-core.md) decisions 7, 14 and 18;
  [WS-033](WS-033-epics.md) (the API); [WS-036](WS-036-projects-pages.md) (the project frame
  and settings pattern); [WS-038](WS-038-task-detail.md) (Markdown)

## Approach

No API change. The page is a client of the four epic operations of WS-033, read and written
in the browser through `/api/v1`, as the board and settings are.

### 1. Route, access and navigation

- `src/app/(app)/projects/[projectKey]/epics/page.tsx`, a server component: it calls
  `requireAccount()` and renders `<EpicsPage canManageEpics={can(actor, "epics:manage")} />`.
  The project key is already checked by the layout, and the project comes from
  `useProject()` (WS-036). Everyone signed in reads epics (`tasks:read`); the API enforces
  `epics:manage` on every write.
- **Navigation (question 1):** the project frame's tabs become **Board**, **Epics**
  (everyone) and **Settings** (managers). "Epics" is current on `/projects/KEY/epics`.
- The route is under `[projectKey]`, so the `@modal` slot's catch-all of WS-038 already
  closes a task dialog when someone navigates here.

### 2. The list (`src/components/epics/`)

- **`EpicsPage`**: a "Show" select with **Open** (default), **Closed** and **All**, mapped to
  the API's `status` and kept in the URL (`?show=closed`), as the projects list keeps its
  view (question 2). Changing it loads from the first page again. "Load more" while
  `nextCursor` is not null. One status region (`role="status"`, named "Epic messages")
  announces every outcome. "New epic" for `canManageEpics` while the project is not
  archived. On an archived project the line "This project is archived. Its epics are
  read-only." is shown.
- **The table** (`<table>` with headers): Title (a button that opens the epic), Status
  (Open / Closed badge), Start, Target (`YYYY-MM-DD`, "—" when not set) and Progress. It
  scrolls inside its own container at phone width, as the settings tables do.
- **Progress** (`EpicProgress`): a `role="progressbar"` with `aria-valuemin` 0,
  `aria-valuemax` the total, `aria-valuenow` the done tasks and the name "2 of 5 tasks done";
  the text "2 / 5" beside it, so colour is never the only signal. With no tasks: "No tasks".
- States: "Loading epics…"; "Could not load the epics." with Retry; "No open epics.", "No
  closed epics." or "No epics yet." by filter.

### 3. One epic (`EpicDialog`)

A dialog opened from the list (not a URL of its own; question 3).

- **For everyone:** title, status, dates, progress, and the description rendered with the
  `Markdown` of WS-038 (raw HTML ignored, safe links only).
- **For `canManageEpics` on a writable project, a form:** Title, Description (the
  `MarkdownEditor` of WS-038, Write and Preview), Start date and Target date
  (`<input type="date">`, clearable). **Save changes**, enabled when something changed, sends
  one `PATCH /api/v1/epics/{id}` with only the changed fields and the `version`; a cleared
  date is sent as `null`. A target date before the start date is refused at the field before
  any request; a `400` from the API shows its field errors.
- **Close epic / Reopen epic** sends `{ status, version }`. Closing an epic with tasks that
  are not done (`doneTasks < totalTasks`) first asks: "Close Launch? 3 of its tasks are not
  done yet." Cancelling changes nothing; with every task done, or none, it closes at once
  (question 4).
- **Answers:** the returned epic replaces the dialog's state and the row in the list (with
  the `version` to use next). `409 version_conflict` refills the form from `current` and
  says "Someone else changed this epic. Their version is shown; make your change again."
  `409 project_archived` reloads the project into the frame, so the page turns read-only.
  Edits not saved yet are kept across a close or reopen, as the task form keeps them
  (WS-038).
- A closed epic that no longer matches the "Open" list leaves it after closing; a reopened
  one leaves the "Closed" list.

### 4. Create (`NewEpicDialog`)

Title (required), Description (`MarkdownEditor`), Start date, Target date. Validated with
`createEpicRequestSchema` in the browser (title, date order); `POST
/api/v1/projects/KEY/epics` sends only the fields given. On `201` the dialog closes, the epic
is added to the list when the list shows open epics (new epics are open), and the status says
"Launch was created." Field errors of a `400` go next to their fields; `project_archived` as
above.

### 5. Shared pieces

- `src/components/epics/api.ts`: `listEpics(projectKey, show, cursor)`, `createEpic`,
  `updateEpic`, through `src/lib/api-client.ts` with the schemas of `epics.ts`.
- **`MarkdownEditor` moves** from `src/components/task/` to `src/components/`, beside
  `Markdown`, now that two features use it (question 5). A move, no change in behaviour; the
  task components import it from there.
- No new UI component and no new dependency.

### 6. Closing WT-03 (question 6)

With this item every work-item of WT-03 is done. In the same branch, each of the ten exit
criteria of WT-03 is checked: by naming the automated tests that cover it (unit,
integration or end-to-end) and, where none does, by adding the missing test. The result is
recorded in WT-03 as a short "Exit check" section, the boxes are ticked, and WT-03 and
`docs/README.md` mark the track Done. If a criterion turns out not to be met, it is not
ticked: it is raised with the owner and recorded as a follow-up.

### 7. Out of scope

An epic's list of tasks and filtering the board by epic (WT-08); story points (WT-10); a URL
per epic; deleting epics (never, WS-033); live updates (WT-04).

## Files

| Path                                                                                | Change                                   |
| ----------------------------------------------------------------------------------- | ---------------------------------------- |
| `src/app/(app)/projects/[projectKey]/epics/page.tsx` (+ `page.integration.test.ts`) | create (tests first)                     |
| `src/components/epics/*.tsx`, `api.ts` (+ `*.test.tsx`)                             | create (tests first)                     |
| `src/components/projects/project-frame.tsx` (+ test)                                | modify: the Epics tab                    |
| `src/components/markdown-editor.tsx`                                                | move from `src/components/task/`         |
| `src/components/task/details-section.tsx`, `comments-section.tsx`                   | modify: the editor's new import          |
| `tests/e2e/epics.spec.ts`; `tests/e2e/accessibility.spec.ts`                        | create; modify                           |
| tests added by the exit check of section 6, if any                                  | create                                   |
| `docs/README.md`, WT-03, WI-039, WS-039                                             | modify: statuses, exit check, track Done |

No migration, no new endpoint, no contract change.

## Data model changes

None.

## API contract

None. The page uses `GET` and `POST /api/v1/projects/{projectId}/epics` and
`PATCH /api/v1/epics/{epicId}` as documented.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                            | Covers criterion |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit        | frame: Board, Epics, Settings in that order (Settings for managers only); Epics links to `/projects/KEY/epics` and is current there                                             | navigation       |
| 2   | integration | the epics page renders for every role with `canManageEpics` true for Manager and Admin only; no session redirects to `/sign-in`                                                 | access           |
| 3   | unit        | list: loading, rows with title, status, dates ("—" when unset) and progress; error with Retry; Load more; the empty message of each filter                                      | list             |
| 4   | unit        | Show: Open by default; Closed and All load from the first page with `status=closed` and `status=all`, and are kept in `?show=`                                                  | list             |
| 5   | unit        | progress: a progressbar with min, max and now, named "2 of 5 tasks done", with "2 / 5" as text; "No tasks" for an epic with none                                                | progress         |
| 6   | unit        | opening an epic as a reader: title, status, dates, progress and the description as Markdown (raw HTML not rendered); no form, date input, Save, Close or Reopen                 | read             |
| 7   | unit        | create: title required; a target before the start refused at the field; posts only the given fields; adds the row to an Open list and not to a Closed one; `400` field errors   | create           |
| 8   | unit        | edit: Save disabled until a change; only changed fields with the `version`, a cleared date as `null`; the answer updates the dialog and the row; the next save uses its version | edit             |
| 9   | unit        | `409 version_conflict` refills from `current` and explains; `project_archived` turns the page read-only and explains                                                            | edit             |
| 10  | unit        | close and reopen send `{ status, version }`; closing with tasks not done asks first and says how many; Cancel changes nothing; with all done it closes at once                  | close            |
| 11  | unit        | no create, edit, close or reopen control without `epics:manage`, nor on an archived project, where the line says why                                                            | read-only        |
| 12  | unit        | accessibility: one named status region; a table with headers; named controls; Escape closes the dialogs and returns focus                                                       | accessibility    |
| 13  | unit        | the `MarkdownEditor` tests, and the task screen's, still pass after the move                                                                                                    | no regression    |
| 14  | e2e         | a Manager creates an epic, edits it, sees tasks given to it through the API counted, moves one to Done and sees the progress change after a reload, closes and reopens it       | end to end       |
| 15  | e2e         | a Member opens the Epics tab, reads an epic's rendered description, has no controls; a closed epic is listed only under Closed and All                                          | read-only        |
| 16  | e2e         | axe finds no violations on the page and on the epic dialog in light and dark mode; at phone width there is no horizontal page scroll                                            | accessibility    |
| 17  | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; `pnpm db:generate` and `pnpm openapi:generate` leave no diff                                                           | gate             |

The tests of section 6 come after these, one per uncovered exit criterion, each written to
fail first where the behaviour is missing.

## Risks and open questions

For the owner:

1. **An "Epics" tab in the project's navigation**, between Board and Settings, for everyone.
   WS-036 already planned it ("WI-039 adds Epics"). **Recommend: as proposed.**
2. **Open epics by default, with a Show select** (Open, Closed, All), matching the API's
   default and kept in the URL like the projects list's view. **Recommend: as proposed.**
3. **An epic opens in a dialog, without a URL of its own.** Epics have no key, and their
   page has little beyond what the dialog shows; a URL per epic can come with WT-08, when an
   epic lists its tasks. The alternative is the intercepting-route pattern of WS-038.
   **Recommend: a plain dialog.**
4. **Closing an epic whose tasks are not all done asks first** and says how many, though the
   API allows it. The alternative is to close at once. **Recommend: ask first.**
5. **`MarkdownEditor` moves to `src/components/`** beside `Markdown`, now that two features
   use it. A move, no behaviour change. **Recommend: as proposed.**
6. **WT-03 is closed in this item** (section 6): its exit criteria are checked against the
   tests, missing tests are added, and the track is marked Done. The alternative is a
   separate small item to close the track. **Recommend: in this item.**
7. **This branch is stacked on WI-038** (`claude/wi-038-task-detail-v2`, PR #35), because it
   needs WI-038's `Markdown` and `MarkdownEditor`. Its pull request is opened after #35 is
   merged, so it shows WI-039 alone. **Owner: agree?**

Technical, settled by the tests:

8. **Progress after a task is moved** comes from the API on the next load of the list; the
   page does not try to recompute it.
9. **A closed epic's title stays shown on its tasks** (WS-033); nothing on the board changes
   when an epic is closed.

## Deviations from the approved spec

- **The epic dialog has its own status region**, also named "Epic messages", showing the
  page's latest message. A modal dialog hides the rest of the page from assistive
  technology, so the page's region alone could not be heard while editing. Found by the
  unit tests, which could not see the page's region either.
- **An epic that no longer matches the list stays until its dialog closes** (closing one
  under "Open"), so the dialog does not vanish from under the person using it.
- **The epic dialog returns the focus to the title button that opened it**, explicitly, as
  the board's "Add task" does (WS-037), because one dialog serves every row and has no
  `DialogTrigger`.
- **Unsaved edits are kept across a close or reopen**, and a conflict starts the form again,
  as in the task form (WS-038).
- **No separate `MarkdownEditor` test file**: there was none before the move; the task and
  epic tests exercise it from its new place.

## Implementation record

- Red: the unit and integration tests failed on the missing modules and the missing Epics
  tab (committed before any code). As in WS-038, the end-to-end tests were not run red,
  because `next build` type-checks tests whose modules do not exist yet.
- Exit check of WT-03 (section 6): nine criteria were covered by existing tests; criterion 5
  got `src/app/api/v1/viewer-writes.integration.test.ts`, which passed at once since the
  behaviour already existed, and was shown to fail with a Member's session instead. The
  mapping is recorded in WT-03, which is now Done.
- Green: 953 Vitest tests (up from 921) and 59 Playwright tests (up from 56) pass, under
  the CSP guard; the epics and accessibility specs passed three repeated runs. Typecheck,
  lint and format pass; `pnpm db:generate` and `pnpm openapi:generate` leave no diff.
- Locally the database was PostgreSQL 16 (no Docker in the sandbox); CI runs the
  PostgreSQL 18 of `compose.yaml`.
