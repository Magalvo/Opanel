# WS-037 — Board page

- Status: Done (approved by the owner on 2026-11-15, with the proposals of questions 1 to 7)
- Work-item: [WI-037](../work-items/WI-037-board-page.md)
- Canonical docs: [0002](../canonical/0002-realtime-sync.md) section 4;
  [0003](../canonical/0003-task-management.md) sections 2, 5;
  [0004](../canonical/0004-api-conventions.md) sections 5, 6;
  [WS-030](WS-030-tasks-core.md), [WS-031](WS-031-move-task.md),
  [WS-036](WS-036-projects-pages.md);
  [WT-03](../work-tracks/WT-03-board-core.md) decisions 5, 6, 7, 11, 15 and risk 5;
  `AGENTS.md` hard rules 4, 6 and 13

## Approach

No API change: the board is a client of `GET /api/v1/projects/{id}/columns`,
`GET /api/v1/projects/{id}/tasks`, `POST /api/v1/projects/{id}/tasks` and
`POST /api/v1/tasks/{key}/move`. The page keeps the project header of WS-036 and replaces
its "The board comes next." line with the board.

### 1. Data and state

`Board` (a client component under `src/components/board/`) receives the project and two
booleans, `canWrite` (the actor has `tasks:write`) and `archived`. It loads the columns, then
every page of tasks (`limit=100`, following `nextCursor` until it is `null`), and groups the
tasks by `columnId`. The API already returns them in board order (decision 11), so the order
inside a column is the order received. States: loading placeholder, "Could not load the
board." with Retry, and the board. A "Reload" button repeats the load (there is no live
update before WT-04).

The board is **writable** only when `canWrite && !archived`; otherwise no create form, no drag
and no menu are rendered at all (the API still refuses the writes).

The state transitions are pure functions in `board-state.ts`, tested without a browser:
`groupTasks`, `moveCard(state, taskId, columnId, index)` and `anchorsFor(state, taskId)`.

### 2. Layout and cards

- **Board region.** A `<div role="region" aria-label="Board" tabindex="0">` with
  `overflow-x: auto`; the columns are laid out in a row inside it, each at least 18 rem wide.
  The page never scrolls sideways: at phone width the region scrolls.
- **Column.** A heading with the column's name and the number of cards, a list of cards, and
  for a writable board the add-task form below the list.
- **Card.** The key (monospace), the title, a badge for the type when it is a bug or a story,
  the assignee's name (with "Deactivated" when `active` is false), the team's name and the
  epic's title when present. Cards are not links yet: the task detail and its URL arrive with
  WI-038.
- **Card menu** (writable board only). A "Actions for OPA-3" button opens a menu with "Move
  to <column>" for every other column, "Move up" (not on the first card) and "Move down" (not
  on the last). It is the way to move a card without dragging, and the way the logic is
  tested in the browser-less unit tests.

### 3. Adding a task

Each column ends with a field "Add a task to <column>" and an "Add" button. Submitting posts
`{ title, columnId }` to `/api/v1/projects/{id}/tasks`; the response (a `Task`) becomes a card
at the end of that column and the field is cleared and keeps focus, so several tasks can be
typed in a row. A blank title is refused in the browser with `taskTitleSchema`; `400` field
errors, `409 project_archived` (the board becomes read-only and says why) and other failures
are announced. Only the title is asked: type, assignee, epic and description are WI-038.

### 4. Moving a card

- **Libraries (decision 15).** `@dnd-kit/core` 6.3.1 and `@dnd-kit/sortable` 10.0.0, with
  `@dnd-kit/utilities` 3.2.2, which the sortable package already needs and the cards use for
  their transform style. Exact versions, as every other dependency of the project. The
  installed packages' documentation is read before the first line of code (hard rule 13).
  They support React 19 (`peerDependencies: react >=16.8`).
- **Sensors.** Pointer (with a small distance so a click is not a drag), Touch (with a short
  delay, so scrolling the board on a phone is not a drag) and Keyboard (Space or Enter to
  pick up, arrows to move, Space or Enter to drop, Escape to cancel).
- **Structure.** One `SortableContext` per column, each column also a droppable (so an empty
  column accepts a card), and a `DragOverlay` so the card being dragged is drawn above the
  columns. The state is updated while dragging over another column, as the library's
  "multiple containers" pattern does, and committed on drop.
- **On drop** (or on a menu action): `moveCard` produces the new state at once (optimistic),
  `anchorsFor` gives the neighbour the server needs — `afterTaskId` of the card above, else
  `beforeTaskId` of the card below, else none (an empty column; the end) — and the page posts
  `{ columnId, afterTaskId | beforeTaskId, version }` to `/api/v1/tasks/{key}/move`, with the
  `version` the card holds. The response replaces the card (new `version`).
- **One move at a time.** While a move is in flight the cards cannot be picked up and the menus
  are disabled; the next move starts from the card as the server answered it. This keeps every
  request based on the version the previous answer returned and needs no queue.
- **Failures.** `409 version_conflict` → reload the whole board and say "Someone else changed
  the board. It was reloaded." Any other failure → put the card back where it was and say
  "Could not move the task. It is back where it was." `409 project_archived` → reload and say
  that the project is archived.
- **Announcements** (`DndContext` accessibility, replaced with plain wording): "Picked up
  OPA-3. It is in To do, position 2 of 4.", "OPA-3 is now in In progress, position 1 of 3.",
  "Dropped OPA-3 in In progress, position 1 of 3.", "Move cancelled. OPA-3 is back in To do."
  Outcomes of the server call go to a `role="status"` region above the board.

### 5. Page and layering

`src/app/(app)/projects/[projectKey]/page.tsx` passes `canWrite = can(actor, "tasks:write")`
and `archived` to the page, which renders `ProjectHeader` and `Board`. The header stays a
server-rendered component; only `Board` is a client component.

### 6. A thousand tasks (WT-03 risk 5)

An end-to-end test seeds 1 000 tasks in one project directly in the database, opens the board
and waits until the last card is visible, recording the time in the test output. The test
asserts a generous bound (15 seconds) so it catches an order-of-magnitude regression without
flaking; the measured numbers go into this spec's implementation record, and the risk is
closed or raised again from them. Virtualising the list is out of scope.

### 7. Out of scope

Opening, editing, assigning, commenting on and deleting a task (WI-038); the epics page
(WI-039); live updates (WT-04); filters, search and the backlog (WT-07, WT-08); moving whole
columns by dragging (WS-036 has buttons); Markdown in cards.

## Files

| Path                                                                                                                        | Change                                       |
| --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `package.json`, `pnpm-lock.yaml`                                                                                            | modify: the three `@dnd-kit` packages, exact |
| `src/components/board/board-state.ts` (+ `.test.ts`)                                                                        | create (tests first): the pure functions     |
| `src/components/board/api.ts`                                                                                               | create: tasks, create and move calls         |
| `src/components/board/board.tsx`, `board-column.tsx`, `task-card.tsx`, `card-menu.tsx`, `add-task-form.tsx` (+ `.test.tsx`) | create (tests first)                         |
| `src/components/projects/project-header.tsx` (+ test)                                                                       | modify: no "board comes next" line           |
| `src/app/(app)/projects/[projectKey]/page.tsx` (+ integration test)                                                         | modify: `canWrite`, `archived`, the board    |
| `tests/e2e/board.spec.ts`, `tests/e2e/seed.ts`                                                                              | create, modify: `seedTasks`                  |
| `docs/README.md`, WT-03, WI-037, WS-037                                                                                     | modify: statuses, risk 5                     |

## Data model changes

None.

## API contract

None. The board uses the four operations above, unchanged.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                                | Criterion     |
| --- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| 1   | unit        | `groupTasks`: tasks fall in their column in received order; a column with none is empty; a task of an unknown column is dropped                                                     | board         |
| 2   | unit        | `moveCard`: within a column (up, down, to the ends), to another column (first, middle, last, into an empty one), onto itself changes nothing; the input state is not mutated        | move          |
| 3   | unit        | `anchorsFor`: below a card gives `afterTaskId`; first place of a non-empty column gives `beforeTaskId`; an empty column gives none; never both                                      | anchors       |
| 4   | unit        | `Board`: loading placeholder, every page followed until `nextCursor` is null, columns in order, cards in order; error and Retry; Reload loads again                                 | board         |
| 5   | unit        | cards show key, title, a type badge only for bug and story, assignee (with Deactivated), team and epic                                                                              | cards         |
| 6   | unit        | add a task: validates, posts `{ title, columnId }`, the card appears at the end of that column, the field is cleared and keeps focus; `400` and failure messages announced          | create        |
| 7   | unit        | menu: "Move to" lists every other column, Move up and Move down are absent at the ends; choosing one posts the right body (`columnId`, one anchor, `version`) and replaces the card | menu          |
| 8   | unit        | a failed move puts the card back and says so; `409 version_conflict` reloads the board and says so; `409 project_archived` reloads and says the project is archived                 | failures      |
| 9   | unit        | while a move is in flight the menus are disabled; after the answer the next move sends the new `version`                                                                            | one at a time |
| 10  | unit        | a Viewer (`canWrite` false) and an archived project render no add form, no menu and no drag handle                                                                                  | read only     |
| 11  | unit        | accessibility: the board region is named and focusable, columns are headed lists, controls have accessible names, one announced status region                                       | accessibility |
| 12  | integration | the project page passes `canWrite` true for Member, Manager and Admin and false for Viewer, and `archived` for an archived project                                                  | access        |
| 13  | e2e         | a Member adds tasks to a column; they get the next keys and survive a reload                                                                                                        | create        |
| 14  | e2e         | a Member drags a card to another column and within a column with the mouse; after a reload the order is the same; the history shows a `moved` event (read through the API)          | drag          |
| 15  | e2e         | the same with the keyboard only: Space, arrows, Space; Escape cancels                                                                                                               | keyboard      |
| 16  | e2e         | a card moved by the menu; a second browser context moves the same card first and the first context's move reloads the board and says so                                             | conflict      |
| 17  | e2e         | a Viewer and an archived project show the board with no controls                                                                                                                    | read only     |
| 18  | e2e         | 1 000 seeded tasks: the board shows every card within the bound; the time is printed                                                                                                | risk 5        |
| 19  | e2e         | at phone width the page does not scroll sideways and the board region does; dark theme; no axe violations                                                                           | responsive    |
| 20  | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; `pnpm openapi:generate` leaves no diff                                                                                     | gate          |

## Risks and open questions

For the owner:

1. **A move menu on every card, now.** Decision 15 puts the non-drag move in the task detail
   (WI-038). A menu on the card costs little and makes moving possible by anyone who cannot
   drag, and lets the logic be tested without a browser. Agree?
2. **Cards are not links until WI-038.** The task detail has its own URL; linking to it before
   it exists would break. Agree?
3. **No polling.** Another person's changes appear when the page is reloaded (a "Reload"
   button) until WT-04. Agree?
4. **One move at a time**, instead of queueing moves. It is simpler and always sends a fresh
   `version`; the cost is that a very fast second drag waits for the first answer. Agree?
5. **Quick add asks only for a title.** Everything else is edited in WI-038. Agree?
6. **Three new dependencies**, exact: `@dnd-kit/core` 6.3.1, `@dnd-kit/sortable` 10.0.0 and
   `@dnd-kit/utilities` 3.2.2. The library was last published in December 2024; it is
   widely used and decision 15 chose it, but it is not moving fast. The alternative is to
   write the drag handling by hand, which I do not recommend. Agree to the dependencies?
7. **The thousand-task bound** of 15 seconds in an end-to-end test is deliberately loose, and
   the real figure is recorded rather than asserted tightly. Agree?

## Deviations from the approved spec

1. **The board's messages are a status region named "Board messages".** dnd-kit renders a live
   region of its own with `role="status"`, so the page has two; ours is found by its name in
   tests (unit and end-to-end).
2. **The "is over" announcement is not made while a card is over itself.** dnd-kit announces
   it right after "Picked up", which replaced the pick-up announcement at once for a screen
   reader. Found by the keyboard end-to-end test, which waits for the words.
3. **Test 14 does not check a `moved` event.** There is no endpoint that reads task history
   before WT-08, so the test checks that the order survives a reload.
4. **A new server component, `ProjectView`,** draws the header and the board, so the page
   passes `canManage`, `canWrite` and the project to one element. `Board` takes `project`,
   `canWrite` and `archived`, as the spec said.
5. **The add field ignores a second Enter while one is on its way** and clears itself only if
   nothing else was typed meanwhile (a unit test fails without it). Two creations in flight
   could otherwise reach the server in either order.
6. **Test fixture corrected:** a task's `reporter` is `{ id, name }`, not a person with `active`.
7. **Handles, not whole cards, start a drag** (`Drag OPA-1`), as the tests state, so the card's
   menu is not nested inside a draggable and a touch scroll over a card is a scroll.
8. The installed packages' documentation (type definitions and README under
   `node_modules/@dnd-kit`) was read before the code (hard rule 13).

## Implementation record

- Red: committed first on this branch; the board, state and page tests failed on the missing
  modules and the old header.
- Green: 799 Vitest tests and 47 Playwright tests (nine new) pass, twice in a row. Typecheck,
  lint and format pass; `pnpm openapi:generate` leaves no diff.
- **A thousand tasks (WT-03 risk 5):** 1 003 tasks (1 000 seeded plus three), measured in the
  end-to-end test on this sandbox: the last card is visible after 0.7 to 1.5 seconds
  (721, 886, 1 286, 1 278, 1 467 ms over five runs). That is comfortable, so the risk stays
  accepted until WT-07 moves unscheduled work to the backlog; the bound of the test is 15 s.
- Dragging with the mouse within and between columns, and with the keyboard (Space, arrows,
  Space; Escape to cancel), work in Chromium.
- Locally the database was PostgreSQL 16 (no Docker in the sandbox); CI runs the
  PostgreSQL 18 of `compose.yaml`.
