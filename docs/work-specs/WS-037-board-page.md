# WS-037 — Board page: columns, cards, create a task, drag and drop

- Status: Proposed (awaiting owner approval)
- Work-item: [WI-037](../work-items/WI-037-board-page.md)
- Canonical docs: [0002](../canonical/0002-realtime-sync.md) section 4;
  [0003](../canonical/0003-task-management.md) sections 2, 4 and 5;
  [0004](../canonical/0004-api-conventions.md) sections 4 and 5;
  [WT-03](../work-tracks/WT-03-board-core.md) decisions 4, 5, 6, 7, 11, 15 and risk 5;
  [WS-030](WS-030-tasks-core.md), [WS-031](WS-031-move-task.md) (the APIs);
  [WS-036](WS-036-projects-pages.md) (the project frame this page lives in)

## Approach

### 1. Route and access

`src/app/(app)/projects/[projectKey]/page.tsx` replaces the placeholder of WS-036. It is a
server component that calls `requireAccount()` and renders `<Board canWriteTasks={...} />`
with `can(actor, "tasks:write")`. The project comes from `useProject()` (the frame of
WS-036 already loaded it); the board reads its columns and tasks through the API, which
stays the guard. Every human role reads the board (`tasks:read`).

Writes are offered when `canWriteTasks` is true **and** the project is not archived
(`archivedAt === null`). Otherwise the board is read-only: no "Add task", drag disabled,
and on an archived project the line "This project is archived. The board is read-only."

### 2. Loading

- `GET /api/v1/projects/KEY/columns` (returned whole, decision 10) and
  `GET /api/v1/projects/KEY/tasks?limit=100`, following `nextCursor` until it is `null`
  (decision 11: the board loads every page). Both run in parallel; the board is shown
  when both are complete.
- Tasks are grouped by `columnId`, keeping the API's order, which is board order.
- States: "Loading the board…" with skeleton columns; "Could not load the board." with
  Retry (`role="alert"`); an empty column shows "No tasks".
- The same `loadBoard()` is used after a failed move (section 5), so a reload always
  replaces the whole board state.

### 3. Layout

- The columns sit side by side in a region (`role="region"`, `aria-label="Board"`,
  `tabIndex={0}`) that scrolls horizontally on its own, so the page never does. Each column
  is a fixed-width `<section>` labelled by its heading: the column name, its category as a
  small badge (To do, In progress, Done, from `CATEGORY_LABELS`), and its task count.
- Cards are a `<ul>` of `<li>` per column. A card shows the key (monospace), the title
  (wrapping, never truncated away), the type (Task, Bug, Story, as a text badge with an
  icon from `lucide-react`), and, when set, the assignee's name and the team's name.
  A deactivated assignee is shown with "(inactive)".
- Cards are not links in this item (question 2); WI-038 makes them open the task detail.

### 4. Creating a task

- With writes allowed, each column has an "Add task" button at its foot. It opens a dialog
  with **Title** (required, `taskTitleSchema`) and **Type** (native `<select>`: Task, Bug,
  Story; default Task), as the category field of WS-036.
- `POST /api/v1/projects/KEY/tasks` with `{ title, type, columnId }`. On `201` the task is
  appended to that column and the status region says "OPA-13 was added to To do."
- `400` field errors are shown at the field; `409 project_archived` closes the dialog,
  reloads the project into the frame (`setProject`) so the board turns read-only, and says
  "The project is archived."

### 5. Drag and drop (decision 15)

Built with `@dnd-kit/core` and `@dnd-kit/sortable`: one `DndContext` for the board, one
`SortableContext` per column (vertical list strategy), each column also a droppable so an
empty column accepts a card. Sensors: `PointerSensor` (with a 5 px activation distance, so
a click is not a drag), `TouchSensor` (with a short press delay, so the board still
scrolls by touch) and `KeyboardSensor` with `sortableKeyboardCoordinates`. A
`DragOverlay` shows the card being dragged.

**Keyboard:** a card is focusable; Space or Enter picks it up, arrow keys move it within
and across columns, Space or Enter drops it, Escape cancels. Instructions and
announcements are given in words through `@dnd-kit`'s `accessibility` options, by task key
and column name: "Picked up OPA-12.", "OPA-12 is in In progress, position 2 of 5.",
"OPA-12 was moved to In progress, position 2 of 5.", "Moving OPA-12 was cancelled."

**The request.** A pure function in `src/components/board/moves.ts` turns a drop into the
move request: given the target column's task ids **after** the drop and the moved id, it
sends `afterTaskId` = the task just above, or, when the card is first, `beforeTaskId` = the
task just below, or neither when the column is otherwise empty (then the API puts it at the
end, which is its only place). It always sends `columnId` and the card's `version`. A drop
back on the card's own place sends nothing.

**Optimistic, then reconciled** (doc 0002 section 4):

1. On drop, the card is placed at once in the local state.
2. `POST /api/v1/tasks/{id}/move`. On `200` the returned task replaces the card (new
   `version`); its place is already right.
3. On **any** failure (`409 version_conflict`, `409 project_archived`, `404`, network),
   the whole board is reloaded (section 2), and the status region explains:
   `version_conflict` "Someone else changed OPA-12. The board was refreshed.";
   `project_archived` "The project is archived." (and the project is reloaded into the
   frame); `404` "OPA-12 no longer exists. The board was refreshed."; otherwise "Could not
   move OPA-12. The board was refreshed." Reloading, instead of putting back the old
   place, is what keeps the board equal to what the server holds.
4. While a move is in flight, further drags are disabled, so moves never overlap and each
   one is computed from a confirmed board.

### 6. Shared pieces

- `src/components/board/api.ts`: `listColumns` (reused from `projects/api.ts`),
  `listAllTasks(key)`, `createTask(key, body)`, `moveTask(id, body)`, with the shared
  schemas of `tasks.ts`, `columns.ts` and `problem.ts`, through `src/lib/api-client.ts`.
- One status region (`role="status"`) per board for every outcome; drag announcements use
  `@dnd-kit`'s own live region, as that library expects.
- Built from the existing `src/components/ui/` pieces. No new UI component.

### 7. New dependencies (decision 15: versions pinned here)

| Package              | Version | Why                                               |
| -------------------- | ------- | ------------------------------------------------- |
| `@dnd-kit/core`      | 6.3.1   | `DndContext`, sensors, droppables, `DragOverlay`  |
| `@dnd-kit/sortable`  | 10.0.0  | `SortableContext`, keyboard coordinates for lists |
| `@dnd-kit/utilities` | 3.2.2   | `CSS.Transform.toString` for the card's transform |

These are the latest releases of the packages WT-03 names; their peer ranges accept
React 19. Their last releases date from 2024; the maintainers' newer `@dnd-kit/react` is
still `0.x` (question 1). Under hard rule 13, the packages ship no docs in
`node_modules`, so their bundled type declarations and READMEs of the installed versions
are the reference, and every use is covered by an end-to-end test in a real browser.

They move cards through inline `transform` styles set from JavaScript, which the Content
Security Policy of WS-041 (`style-src 'self' 'unsafe-inline'`) allows; the end-to-end
tests catch it if that changes.

### 8. Large boards (WT-03 risk 5)

An end-to-end test seeds a project with 1 000 tasks spread over three columns directly in
the database, opens the board, checks that the last task of each column is shown and that
one card can still be moved, and logs how long the board took to appear. The measured time
(on CI and locally) goes in the implementation record. The test asserts correctness, not a
time limit (question 3).

### 9. Out of scope

The task detail and its URL, editing, assigning, epics, the column select that moves a task
without dragging, and deleting (WI-038); the epics page (WI-039); live updates (WT-04);
filtering the board (WT-08); the backlog (WT-07); reordering columns by drag and drop (they
are reordered in settings, WS-036).

## Files

| Path                                                                                                              | Change                                        |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `src/app/(app)/projects/[projectKey]/page.tsx` (+ `page.integration.test.ts`)                                     | replace the placeholder (tests first)         |
| `src/components/board/moves.ts` (+ `moves.test.ts`)                                                               | create (tests first)                          |
| `src/components/board/api.ts`                                                                                     | create                                        |
| `src/components/board/board.tsx`, `board-column.tsx`, `task-card.tsx`, `new-task-dialog.tsx` (+ `board.test.tsx`) | create (tests first)                          |
| `package.json`, `pnpm-lock.yaml`                                                                                  | add the three `@dnd-kit` packages, exact pins |
| `tests/e2e/board.spec.ts`; `tests/e2e/seed.ts`; `tests/e2e/accessibility.spec.ts`                                 | create; modify (seed tasks); modify           |
| `docs/README.md`, WT-03, WI-037, WS-037                                                                           | modify: statuses                              |

No migration, no new endpoint, no contract change.

## Data model changes

None.

## API contract

None. The page uses the column, task-list, create-task and move-task operations of WS-029,
WS-030 and WS-031 as documented.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                                                        | Covers criterion |
| --- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit        | `moves.ts`: first place sends `beforeTaskId` of the next task; middle and last send `afterTaskId` of the previous; alone in a column sends neither; same place sends nothing; always `columnId` + `version` | move request     |
| 2   | unit        | `moves.ts`: applying a drop to the board state moves the card within a column and across columns, and leaves every other card in order                                                                      | move             |
| 3   | integration | `/projects/KEY` renders the board for every role, with `canWriteTasks` true for Member, Manager and Admin and false for Viewer                                                                              | access           |
| 4   | unit        | board: loading, columns in order with name, category and count; cards in order with key, title, type, assignee and team; "No tasks"; "(inactive)"; error with Retry                                         | board            |
| 5   | unit        | board: follows `nextCursor` until `null` and groups every page's tasks by column                                                                                                                            | board            |
| 6   | unit        | add task: title required, type default Task; sends `columnId`; appends the new card at the end of its column and announces it; field errors at the field; `project_archived` turns the board read-only      | create           |
| 7   | unit        | read-only: no "Add task" and no draggable cards for a Viewer; on an archived project for everyone, with the explaining line                                                                                 | read-only        |
| 8   | unit        | move outcome: `200` keeps the place and takes the new `version`; `409 version_conflict`, `project_archived`, `404` and a network failure each reload the board and give their message                       | reconcile        |
| 9   | unit        | every control has an accessible name; the board region is focusable; outcomes are announced; Escape closes the dialog and returns focus                                                                     | accessibility    |
| 10  | e2e         | a Member creates tasks in two columns, drags one to another column and one within a column with the mouse; after a reload the order is the same and the API agrees                                          | end to end       |
| 11  | e2e         | the same moves by keyboard only (focus a card, Space, arrows, Space); the drop is announced; the order survives a reload                                                                                    | keyboard         |
| 12  | e2e         | a stale card: the task is moved through the API first, then dragged on the page; the board refreshes and says someone else changed it                                                                       | reconcile        |
| 13  | e2e         | a Viewer sees the board and cards, no "Add task", and a card does not move when dragged; an archived project shows the read-only line to a Manager                                                          | read-only        |
| 14  | e2e         | 1 000 seeded tasks: every column's last card is shown and one card can be moved; the load time is logged                                                                                                    | large board      |
| 15  | e2e         | axe finds no violations on the board, empty and with tasks, in light and dark mode; at phone width there is no horizontal page scroll                                                                       | accessibility    |
| 16  | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; `pnpm db:generate` and `pnpm openapi:generate` leave no diff                                                                                       | gate             |

Dragging with a pointer depends on element geometry, which jsdom does not have, so drag
gestures are tested in Playwright (10 to 14). The unit tests cover the pure logic of
`moves.ts` and the component's handling of each API answer, by calling the board's drop
handler with a drop result.

## Risks and open questions

For the owner:

1. **`@dnd-kit/core` 6.3.1 and `@dnd-kit/sortable` 10.0.0** (section 7), as WT-03 decision
   15 names them. They are stable and widely used, but their last releases are from
   December 2024; the same authors' successor, `@dnd-kit/react`, is at 0.5.3 and not yet
   1.0. **Recommend: the stable `core` + `sortable` now**; moving to `@dnd-kit/react` once it
   reaches 1.0 would be its own work-item, touching only `src/components/board/`.
2. **Cards are not clickable until WI-038.** The alternative is to link each card to
   `/projects/KEY/tasks/KEY-12` now, which would show a not-found page until WI-038.
   **Recommend: not clickable now.**
3. **The 1 000-task test checks correctness and logs the time, with no time limit**,
   because CI machines vary and a timing assertion would be flaky. If the measured time is
   poor, I report it and propose a follow-up rather than optimise inside this item.
   **Recommend: as proposed.** Alternative: fail the test above a generous limit (for
   example 10 s).
4. **On a failed move the whole board is reloaded**, rather than putting the card back
   where it was. One extra load after a rare failure, in exchange for never showing a
   board the server does not hold (other moves may have happened too). **Recommend: as
   proposed.**
5. **The create dialog asks only for title and type.** Description, assignee and epic are
   set from the task detail in WI-038, where their pickers live. **Recommend: as
   proposed.**

Technical, settled by the tests:

6. **Overlapping moves.** Drags are disabled while a move is in flight (section 5, step 4),
   so each request is computed from a board the server confirmed.
7. **Order across pages.** The task list is ordered by column position, then task
   position; grouping keeps that order, so a column split across two pages is still in
   order (test 5).
