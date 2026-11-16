# WI-037 — Board page: columns, cards, create a task, drag and drop

- Status: Done
- Work-track: [WT-03](../work-tracks/WT-03-board-core.md) (decisions 4, 5, 6, 7, 11, 15;
  risk 5)
- Depends on: WI-031, WI-036
- Work-spec: [WS-037](../work-specs/WS-037-board-page.md)

## Outcome

At `/projects/KEY`, every signed-in person sees the project's kanban board: its columns in
board order, each with its tasks as cards in board order. A Member, Manager or Admin creates
a task in a column and moves cards between and within columns by drag and drop, with the
mouse, by touch or by keyboard; the new order is saved through
`POST /api/v1/tasks/{id}/move` and survives a reload. A Viewer, and everyone on an archived
project, sees the same board read-only. The page uses only the existing `/api/v1`
endpoints.

## Acceptance criteria

- [x] `/projects/KEY` shows the columns in board order with name, category and task count,
      and every task of the project as a card in board order (all pages of the task list
      are loaded). A card shows key, title, type, and the assignee (person, team or both).
- [x] A person with `tasks:write` adds a task to a column (title and type); it appears at
      the end of that column with its new key, and the outcome is announced.
- [x] A person with `tasks:write` moves a card within a column and to another column, empty
      or not, by pointer and by keyboard. The move sends the right `afterTaskId` /
      `beforeTaskId` and the card's `version`, and the order is the same after a reload.
- [x] A move is shown at once and kept with the task the API returns. A
      `409 version_conflict`, `project_archived` or any other failure reloads the board
      and says so in plain words; nothing is left in a state the server does not hold.
- [x] A Viewer sees the board with no "Add task" and cannot drag. On an archived project
      nobody can add or drag, and a line says why.
- [x] Loading, empty column, and "could not load the board" (with Retry) states exist.
- [x] Drag and drop announces pick-up, position and drop by task key and column name.
- [x] The board has no accessibility violations in light and dark mode; at phone width the
      board scrolls inside its own region and the page has no horizontal scroll.
- [x] A board of 1 000 tasks loads and is usable; the measured load time is recorded in
      the work-spec's implementation record (WT-03 risk 5).
- [x] `@dnd-kit` is added with exact pinned versions.
- [x] The full quality gate passes.

## Notes

The task detail (opening a card, editing fields, the column select that moves a task
without dragging, deleting) is WI-038. Live updates from other people are WT-04; until
then the board shows other people's changes on reload or after a failed move.
