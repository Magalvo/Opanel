# WI-123 — The live board keeps the newest state

- Status: In progress (approved by the owner on 2026-11-25, with WS-123)
- Work-track: none: follow-ups C02, C03 and C04 of the independent audit of 2026-11-24,
  with the version check of B15 (audit of 2026-11-19), confirmed in the code of `main`
- Depends on: none
- Work-spec: [WS-123](../work-specs/WS-123-live-board-consistency.md)

## Outcome

A project page never shows an older state than one it has already shown, and never shows a
task twice:

- After the events stream reconnects, the project's name and archived state are read again,
  as the board already is (C02). The frame never replaces a project with an older version
  of it, whichever answer arrives last (B15's version check).
- A column read that a newer change has overtaken is never applied: it is read again
  (C03).
- Loading the board, or one column, keeps one card per task, its newest version (C04).

## Acceptance criteria

- [ ] After a reconnect with no `project.changed` event, the frame shows the project as
      the server now holds it (a rename, an archive).
- [ ] The frame keeps the newest project version it has shown: an older answer, from any
      reader (the frame, the board, the settings, the events provider), changes nothing.
- [ ] A column read started before a newer change to that column (an event applied in
      place, a removal, another column's read taking a card out, a local move, a full load)
      is not applied; the column is read again, and the board ends with the newest state.
- [ ] A column read whose answer arrives during a drag or a move is not applied then; the
      column is read again once the drag or the move ends.
- [ ] A task's refreshed card arriving during a drag or a move is not applied then; the
      task is read again once it ends (the follow-up of WS-082 question 3).
- [ ] A task listed twice while the board or a column loads (moved during the load) is
      shown once, in the place of its newest version.
- [ ] Each case above is covered by a test with delayed answers, written first.
- [ ] The full quality gate passes.

## Notes

The "paused" status line of B15 (the browser retrying the stream on its own) is a separate
UI change and stays a follow-up. Paging or virtualising the board (WS-116 and WS-118's
follow-up on slow task lists) is out of scope.
