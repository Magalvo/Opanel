# WI-111 — Board moves without dragging, and drags respect reduced motion

- Status: Done (2026-11-23)
- Work-track: none: two accessibility defects found in a review of the board UI on
  2026-11-23
- Depends on: none
- Work-spec: [WS-111](../work-specs/WS-111-board-drag-accessibility.md)

## Outcome

Everything a person can do to a card by dragging, they can also do with single clicks or
taps: move it up or down in its column, to the top or bottom, or to another column. This is
what WCAG 2.2 AA asks of drag operations (2.5.7 Dragging Movements). Today the task
detail's column select moves a task to another column, but a card's place within its
column can only be changed by dragging or with the keyboard.

People who ask their system for reduced motion get a board that does not animate when
cards move: no sliding cards while dragging, and no animated drop. Today every drag
animates, whatever the setting.

## Acceptance criteria

- [x] A person who may change tasks on a project that is not archived finds, on each card, a
      button labelled "Actions for OPA-12" that opens a menu with "Move to top",
      "Move up", "Move down", "Move to bottom" and "Move to" each other column of the board.
- [x] Moves that would not change the card's place are disabled ("Move up" and "Move to
      top" on the first card, "Move down" and "Move to bottom" on the last). The card's own
      column is not offered under "Move to".
- [x] Choosing a move places the card at once, saves it as a drag does (the same request,
      the same handling of a failure), and announces "OPA-12 was moved to In progress,
      position 2 of 5." in the board's status region. A move to another column puts the
      card at the bottom of that column.
- [x] After a move from the menu, the keyboard focus is on the moved card's menu button,
      also when the card went to another column.
- [x] The menu button is not shown to a Viewer or on an archived project, and is disabled
      while a move is being saved.
- [x] With `prefers-reduced-motion: reduce`, dragging a card by pointer or keyboard runs
      no animation: cards do not slide into place, and the dropped card does not animate
      to its place.
- [x] Without that preference, drag animations are unchanged.
- [x] Every existing board unit and end-to-end test passes unchanged.
- [x] The full quality gate passes.

## Notes

The two findings come from a review against the `ui-ux-pro-max` UX guidelines ("Dragging
Movements" and "Reduced Motion", both rated High). The same review found smaller issues
(the board's scrollbar is far below the screen when a column is long, no sign that dragging
is paused while a move saves, scroll snapping at phone width, the column header's category
badge). They are out of scope here; WS-111 lists them as follow-ups. No API or data model
change.
