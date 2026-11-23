# WS-109 — The Backlog page

- Status: Done (approved by the owner on 2026-11-23, questions 1 to 4 as proposed; done on
  2026-11-23)
- Work-item: [WI-109](../work-items/WI-109-backlog-page.md)
- Canonical docs: [0003](../canonical/0003-task-management.md) sections 3 and 5;
  [0002](../canonical/0002-realtime-sync.md) section 4;
  [WT-07](../work-tracks/WT-07-backlog-priority-due-dates-labels.md) decisions 1 to 5 and
  13, questions 1 and 2; [WS-101](WS-101-backlog-api.md) (the API);
  [WS-037](WS-037-board-page.md), [WS-048](WS-048-live-board.md) and
  [WS-082](WS-082-board-reload-ordering.md) (the board this page follows)

## Approach

The web app uses WI-101's endpoints; no server change. Item E (priority and due date in
the UI) also edits the card and the task detail. The page shows rows through the board's
`CardBody`, so what E adds to cards appears here with no further work. Whichever of D and E
merges second takes in `main` (`AGENTS.md` section 8).

Checked against `main` (`77fc176`).

### 1. The route and the navigation

- **`src/app/(app)/projects/[projectKey]/backlog/page.tsx`**, a server component like the
  board's: `requireAccount`, then `<Backlog canWriteTasks={can(actor, "tasks:write")} />`,
  with the title "Backlog". The layout has already checked the project key.
- **`project-frame.tsx`** adds a "Backlog" tab between "Board" and "Epics", current on
  `/projects/KEY/backlog`.
- **A task opened from the backlog.** The task dialog is the intercepting route
  `@modal/(.)tasks/[taskKey]` at the project's level. Next.js intercepts a soft navigation
  from any page under `/projects/KEY` (checked in the installed
  `generate-interception-routes-rewrites.js`: the `Next-Url` pattern ends in `(?:/.*)?`).
  So a row's link opens the task as a dialog over the backlog with no routing change.
  Today the frame makes "Board" current on every `/tasks/` path (WS-038). The frame is a
  layout and stays mounted, so it remembers whether the last list page was the board or
  the backlog, and keeps that tab current while a task is open. A task's own page, loaded
  directly, keeps "Board" (question 3).

### 2. The page

A new `src/components/backlog/backlog.tsx`, built like `board.tsx`:

- **Messages.** A `role="status"` "Backlog messages" line. "Live updates are paused.
  Reconnecting…" while the stream is down. "This project is archived. The backlog is
  read-only." on an archived project. "This project was archived. The backlog is
  read-only." and "This project was unarchived." after a `project.changed` (the board's
  rule, WS-048 section 6).
- **Loading and errors.** A skeleton and "Loading the backlog…", then "Could not load the
  backlog." with "Retry".
- **The list.** A `region` "Backlog" with a heading, the count ("7 tasks") and a `<ol>` of
  rows in backlog order. When empty: "The backlog is empty." Every page is loaded, as the
  board loads every task (WT-03 decision 11; question 2).
- **A row** (`src/components/backlog/backlog-row.tsx`) is a full-width card: the board's
  `CardBody` (key, title link, type, severity, reports, assignee, team, labels) and, when
  writable, a "Move to board" button at its end. Its accessible name is
  "Move OPA-12 to the board". `SortableBacklogRow` adds the drag handle that
  `SortableCard` has ("Move OPA-12 Title", drag attributes on the handle only) and
  `StaticBacklogRow` has none. `CardBody` is shared, not copied.
- **Writable** is `canWriteTasks && project not archived`, as on the board. Otherwise the
  rows are static and there is no "Add task" and no "Move to board".

### 3. Reordering

- `DndContext` with the board's sensors (mouse with a 5 px distance, touch with a 200 ms
  delay, keyboard with `sortableKeyboardCoordinates`) and its `MEASURING` (WS-098). One
  `SortableContext` with `verticalListSortingStrategy`. `closestCenter` is the collision
  detection: there is one list, so the board's cross-column `boardCollision` is not
  needed.
- **The pure part reuses `moves.ts`.** The backlog is held as a one-entry `Board`,
  `{ [BACKLOG]: tasks }`, where `BACKLOG` is a constant key that is never a uuid.
  `applyDrop`, `placeOf` and `moveRequest` then work unchanged. A new
  `src/components/backlog/moves.ts` has `backlogMoveRequest`, which calls `moveRequest`
  and replaces `columnId: BACKLOG` with `null`. The request is the task above as
  `afterTaskId`, or the one below as `beforeTaskId`, and the task's `version`, as on the
  board.
- **Announcements.** "Picked up OPA-12.", "OPA-12 is in position 3 of 7.", "OPA-12 was
  moved to position 3 of 7.", "OPA-12 was dropped in its place.", "Moving OPA-12 was
  cancelled.". The instructions: "To pick up a task, press Space or Enter. Use the up and
  down arrow keys to move it. Press Space or Enter again to drop it, or Escape to
  cancel." After a keyboard drop the focus goes back to the row's handle, as on the
  board.
- **Saving.** Optimistic, as on the board. The row moves at once and the move is sent.
  The answer's version replaces the row's. A failure reloads the backlog and announces
  the reason, with the board's messages and "backlog" for "board" ("Someone else changed
  OPA-12. The backlog was refreshed."). `project_archived` makes the frame read the
  project again.

### 4. Adding and moving to the board

- **"Add task"** sits below the list. It opens `NewTaskDialog`, whose `column` prop
  becomes `Column | null`. With `null` the title is "Add a task to the backlog", the
  description "It goes to the end of the backlog.", and the request sends
  `columnId: null`. The board still passes its column. The new task is appended to the
  list unless its event put it there first (the board's `added` rule, WS-082). The
  message is "OPA-13 was added to the backlog."
- **"Move to board"** sends `POST /tasks/{id}/move` with the first column's id and the
  row's `version`, and no anchor, so the task goes to the end of that column (WT-07
  decision 13). The page loads the columns with the backlog (`listColumns`). A project
  always has at least one column: the last `done` column cannot be deleted. It is not
  optimistic: the row is disabled while the move is saved, then removed. The message is
  "OPA-12 was moved to To do." On failure the backlog reloads, with the messages of
  section 3. After the row is gone, the focus goes to the next row's "Move to board", or
  the previous row's, or "Add task", so a keyboard user is never left on `body`.

### 5. The task detail

- **`details-section.tsx`**, the column select: an enabled "Backlog" option (value `""`)
  comes first, then the columns. It is selected when `columnId` is `null`. This replaces
  the disabled "In backlog" placeholder of WS-101. `onMove` becomes
  `(columnId: string | null) => void`, and `""` maps to `null`. The read view keeps
  "In backlog".
- **`task-detail.tsx`**, `move`: the message is "Moved to the backlog." for `null`.
  **`task/api.ts`**, `moveTaskTo`: `columnId: string | null`. The task goes to the end of
  the backlog (WS-101 section 4).
- The board already drops a card whose task moved to the backlog, both from the task
  detail's window event and from the stream (WS-101 section 7).

### 6. Live

A new hook `src/components/backlog/use-backlog.ts` gives the page `phase`, `columns`,
`tasks`, `moving`, `live`, `reload`, `added`, `drop`, `moveToBoard` and `hold`. It follows
the board's rules: one load at a time and only the latest applied, a load superseded by a
drag or a move dropped, events held during a drag, a move or a load, more than 200 held
events turning into one reload, a reconnect reloading, and the first load when the stream
opens or after 3 s (WS-048, WS-082). The version rule (`isNewer`) and `withLabels` come
from `board/live.ts`, applied to the one-entry `Board`.

| Event                             | Backlog does                                                                                                                                                                             |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `task.created`, `task.restored`   | if not held with this version or newer: fetch the task; in the backlog → reload the backlog (its place is unknown); on the board → nothing                                               |
| `task.moved`                      | if the held version is older, or the task is not held: fetch it; in the backlog → reload the backlog (a reorder or an arrival changes the order); on the board → remove the row if held  |
| `task.updated`                    | if the held version is older: fetch it; still in the backlog → replace the row in place (an edit does not change the order); on the board or deleted → remove. Not held: as `task.moved` |
| `task.deleted`                    | remove the row (the payload is enough)                                                                                                                                                   |
| `label.changed`                   | one `GET` of the labels, and `withLabels` rewrites the rows (WS-108 section 4)                                                                                                           |
| `column.changed`                  | read the columns again, for "Move to board" and its message; the rows do not change                                                                                                      |
| `project.changed`                 | nothing: the frame reads the project again (WS-049 section 2)                                                                                                                            |
| `comment.created`, `epic.changed` | nothing: a row shows neither                                                                                                                                                             |

"Reload the backlog" reads every page of `GET /backlog` and replaces the list. It goes
through the ordered load, so a burst of moves costs at most one more load. A task fetched
as `404` or deleted is removed.

Every `task.*` event of the project costs at most one fetch of that task here, as on the
board. Board moves therefore reach an open backlog as one `GET` each and no reload
(question 1).

The task detail's window events (`onTaskEvents`, WS-038 section 4) are applied too. A
changed task held and still in the backlog is replaced in place. One held and now on the
board is removed. One not held and now in the backlog reloads the backlog (it went to the
end). A deleted task is removed.

### 7. One hook, not a shared one

`use-backlog.ts` has the same load ordering and event holding as `use-board.ts`, about 150
lines of the same shape. Extracting them into a shared hook would change the board, which
item E edits in parallel, and its 900 lines of tests. This item keeps `use-board.ts` as it
is, and `use-backlog.ts` has its own tests of the same cases (question 1).

## Files

| Path                                                                     | Change                                        |
| ------------------------------------------------------------------------ | --------------------------------------------- |
| `src/app/(app)/projects/[projectKey]/backlog/page.tsx`                   | create                                        |
| `src/app/(app)/projects/[projectKey]/backlog/page.integration.test.ts`   | create: rights per role, sign-in redirect     |
| `src/components/projects/project-frame.tsx`, `project-frame.test.tsx`    | modify: the "Backlog" tab, the remembered tab |
| `src/components/backlog/backlog.tsx`, `backlog.test.tsx`                 | create: the page                              |
| `src/components/backlog/backlog-row.tsx`, `backlog-row.test.tsx`         | create: sortable and static rows              |
| `src/components/backlog/moves.ts`, `moves.test.ts`                       | create: `BACKLOG`, `backlogMoveRequest`       |
| `src/components/backlog/use-backlog.ts`, `use-backlog.test.tsx`          | create: load, events, drop, move to the board |
| `src/components/backlog/api.ts`                                          | create: `listAllBacklog`                      |
| `src/components/board/new-task-dialog.tsx`, `board.test.tsx`             | modify: `column: Column \| null`              |
| `src/components/task/details-section.tsx`, `task-detail.tsx`, their test | modify: the "Backlog" option, its message     |
| `src/components/task/api.ts`                                             | modify: `moveTaskTo` takes `null`             |
| `tests/e2e/backlog.spec.ts`                                              | create                                        |
| `tests/e2e/accessibility.spec.ts`                                        | modify: the Backlog page, light and dark      |
| `docs/work-items/WI-109-backlog-page.md`, this file                      | status                                        |

## Data model changes

None.

## API contract

None; the web app uses WI-101's endpoints.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                                                                                | Covers criterion |
| --- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit        | `backlog/moves.ts`: `backlogMoveRequest` gives `columnId: null` with the task above as `afterTaskId`, the one below as `beforeTaskId` when first, neither when alone, and `null` for a drop in its own place                        | 3                |
| 2   | unit        | the frame: tabs "Board", "Backlog", "Epics" (and "Settings"); "Backlog" current on `/backlog`; a task path after the backlog keeps "Backlog" current, after the board or loaded directly keeps "Board"                              | 1                |
| 3   | integration | the route: every role gets the page with `canWriteTasks` as its role holds it; no session redirects to `/sign-in`                                                                                                                   | 1, 7             |
| 4   | unit        | `use-backlog`: loads every page in order with the columns; reports an error and loads again on retry; appends an added task once, even when its event came first                                                                    | 2, 4             |
| 5   | unit        | `use-backlog`, a drop: shown at once, the move sent with `columnId: null` and its anchor, the answer's version taken; a failure (`version_conflict`, `404`, network, `project_archived`) reloads and announces                      | 3                |
| 6   | unit        | `use-backlog`, "Move to board": sends the first column's id and the version with no anchor, removes the row, announces "moved to ‹column›"; a failure reloads and announces                                                         | 5                |
| 7   | unit        | `use-backlog`, events: each row of the table in section 6, including a board move that only fetches, an echo ignored by the version rule, a `404` removed, and the task detail's window events                                      | 8                |
| 8   | unit        | `use-backlog`, ordering: events held during a drag and a move and applied after; over 200 held events give one reload; a reconnect reloads; one load at a time, only the latest applied; a load superseded by a drag dropped        | 8                |
| 9   | unit        | the page: rows in order with the card's content and a link to the task; "The backlog is empty."; the count; loading, error and "Retry"; the paused notice                                                                           | 2                |
| 10  | unit        | the page, writable: handles, "Move to board" named per task, "Add task" opens the dialog titled "Add a task to the backlog" which sends `columnId: null`; focus after "Move to board" goes to the next row, previous, or "Add task" | 3, 4, 5          |
| 11  | unit        | the page, read-only: a Viewer, and an archived project (and one archived live, with its message), have no handles, no "Add task" and no "Move to board"                                                                             | 7                |
| 12  | unit        | the board's "Add task" still sends its column's id and says "Add a task to ‹column›"                                                                                                                                                | 4                |
| 13  | unit        | the task detail: the column select offers "Backlog" first, selected for a backlog task; choosing it sends `columnId: null` and says "Moved to the backlog."; choosing a column for a backlog task moves it to the board             | 6                |
| 14  | e2e         | accessibility, light and dark: the Backlog page with tasks, as a Member                                                                                                                                                             | 9                |
| 15  | e2e         | a Member adds two tasks to the backlog, reorders them by drag and by keyboard, reloads and sees the order, moves one to the board with "Move to board" and back with the task detail's "Backlog"                                    | 3, 4, 5, 6, 10   |
| 16  | e2e         | live: a second page's backlog and board follow the first page's creation, reorder and moves with no reload                                                                                                                          | 8, 10            |
| 17  | gate        | `pnpm check`, `pnpm test`, `pnpm test:e2e`                                                                                                                                                                                          | all              |

## Risks and open questions

1. **A hook of its own for the backlog (section 7).** `use-backlog.ts` repeats the
   board's load ordering and event holding, about 150 lines, with its own tests.
   Extracting a shared hook is cleaner, but it would rework `use-board.ts` while item E
   edits the board, and the risk lands on the most tested part of the app. **Recommend:
   a hook of its own now, and a follow-up to extract the shared part when WT-10 adds
   sprint sections to this page.** Alternative: extract the shared hook first, in this
   item.
2. **Load every page.** The board loads every task (WT-03 decision 11). The backlog does
   the same, because drag and drop needs the neighbours shown and a "Load more" list
   cannot rank its last task above an unloaded one. A large backlog is slower to open;
   WT-08's list view and filters are the place for very large lists. **Recommend: every
   page, like the board.** Alternative: pages of 100 with "Load more", and reordering only
   among loaded rows.
3. **Which tab is current while a task is open.** Today "Board" is current on every task
   path (WS-038), so a task opened from the backlog would mark "Board". **Recommend: the
   frame remembers the last list page (board or backlog) and keeps its tab current; a
   task loaded directly keeps "Board".** Alternative: leave it as it is.
4. **"Move to board" is not optimistic.** A drop is optimistic because the row stays on the
   page. "Move to board" takes the row away, so a failure would bring it back.
   **Recommend: disable the row while the move is saved, then remove it.** Alternative:
   remove it at once and reload on failure.

Risks:

- **Item E edits the same card and task detail.** Rows use `CardBody`, so E's priority and
  due date reach rows by themselves. Whichever merges second takes in `main` and runs the
  gate again.
- **A board move costs open backlogs one `GET` of the task** to learn whether it entered
  the backlog. The board already pays the same per event. `TaskSummary` has no position
  (WS-048 question 1), so the event alone cannot decide it.
- **The keyboard drag on one long list** relies on `sortableKeyboardCoordinates` and the
  board's rounded measuring (WS-098). The end-to-end test 15 drags by keyboard over three
  rows to catch a misdirected arrow key.

Observation for the owner (not in this item's scope): reading `use-board.ts` for this
spec, `placeTask` replaces a card in place when a refreshed task is still in the same
column. So another person's reorder within one column seems not to reach an open board
until a reload, where WS-048 section 4 says `task.moved` reloads the new column. This is
from reading the code, not from running it. If it is confirmed, it is a follow-up for the
board. This page reloads the backlog on every `task.moved` of a backlog task, so it does
not have the problem.

## Implementation record

- Branch `claude/wi-109-backlog-page`, from `main` after the reservation (`77fc176`). No
  server change.
- Red (`454d133`): the new backlog tests failed on the missing `moves`, `use-backlog` and
  `backlog` modules. The frame tests failed on the missing "Backlog" tab. The task detail
  tests failed on the missing "Backlog" option.
- Green (`c197afe`): `components/backlog` (`api.ts`, `moves.ts`, `use-backlog.ts`,
  `backlog-row.tsx`, `backlog.tsx`), the route, the frame's "Backlog" tab and remembered
  list, `NewTaskDialog` with `column: null`, and the "Backlog" option in the task detail.
- End to end (`6809d18`): `tests/e2e/backlog.spec.ts` (tests 15 and 16) and the Backlog
  page with a task dialog over it in the accessibility check. The check found the
  "Move to board" name problem of deviation 2.
- Gate on 2026-11-23: typecheck, lint and Prettier pass; Vitest 2131 of 2131;
  `pnpm test:e2e --retries=0` 107 of 107. Windows 11, pnpm 10.28.0, Compose PostgreSQL
  on port 5433.

## Deviations

1. **No `backlog-row.test.tsx`.** The rows render only inside the page, with a
   `DndContext` for the sortable one. Their tests are in `backlog.test.tsx`: content,
   link, handle, "Move to board", and no controls when read-only.
2. **"Move to board" is named "Move to board OPA-12"**, not "Move OPA-12 to the board"
   (section 2). The accessibility check refused the planned name: an accessible name must
   contain the visible text (WCAG 2.5.3, axe `label-content-name-mismatch`). The task's
   key follows the visible text, in an `sr-only` span.
3. **`reorder` is the backlog's own function, not `applyDrop`.** `applyDrop` writes the
   target column's id into the moved task, which would put the `BACKLOG` key in a backlog
   task's `columnId`. `backlogMoveRequest` still calls the board's `moveRequest`, as
   section 3 says.
4. **"Backlog" in the column select has the value `""`.** A `<select>` holds strings, and
   `""` maps to `null`. The read view keeps "In backlog".
5. **The test numbering.** Tests 4 to 8 are in `use-backlog.test.tsx` and tests 9 to 11 in
   `backlog.test.tsx`. Test 12, the board's dialog with its column, is the existing
   board test, which passes unchanged.
