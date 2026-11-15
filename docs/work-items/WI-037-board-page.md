# WI-037 — Board page

- Status: Done
- Work-track: [WT-03](../work-tracks/WT-03-board-core.md) (decisions 5, 6, 7, 11, 15; risk 5)
- Depends on: WI-031, WI-036 (the board takes the place of the project page's body)
- Work-spec: [WS-037](../work-specs/WS-037-board-page.md)

## Outcome

`/projects/KEY` shows the project's board: its columns left to right, each with its cards in
order. A person who can write creates a task from the bottom of a column and moves a card
within and between columns, by dragging, by keyboard or from a menu on the card. Every move
is saved through the move endpoint of WI-031 and survives a reload. Someone who cannot write,
and anyone looking at an archived project, sees the same board without the controls.

## Acceptance criteria

- [x] The board shows every column in board order and every task of the project in its
      column, in the order the API returns them, across all pages of the list. Each card
      shows the key, the title, the type (for a bug or a story), the assignee and team, and
      the epic.
- [x] A Member, Manager or Admin adds a task to a column by typing a title; it appears at
      the end of that column with the next key of the project.
- [x] A card can be dragged within its column and to another column, and the order survives
      a reload. The same can be done with the keyboard alone (pick up, arrows, drop).
- [x] Every card also has a menu with "Move to" each column and "Move up" and "Move down",
      so a move needs no dragging at all.
- [x] Each move sends the task's `version` and the right neighbour; a `409 version_conflict`
      reloads the board and says so; any other failure puts the card back and says so.
- [x] A Viewer, and an archived project, show no create form, no drag handles and no menu.
- [x] Screen readers hear what was picked up, where it is and where it was dropped.
- [x] A board of 1 000 tasks loads and shows every card; the time is measured and recorded
      (WT-03 risk 5).
- [x] The page does not scroll sideways at phone width (the columns scroll inside the board),
      renders in the dark theme, and has no axe violations.
- [x] The full quality gate passes.

## Notes

Opening a card (the task detail with its own URL), editing, assigning and commenting are
WI-038. Live updates from other people are WT-04: until then the board offers a "Reload"
button.
