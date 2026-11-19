# WI-082 — The board applies only the latest load, never during a move

- Status: Approved (2026-11-19)
- Work-track: none: a fix from the audit of 2026-11-19 (finding B04)
- Depends on: none
- Work-spec: [WS-082](../work-specs/WS-082-board-reload-ordering.md)

## Outcome

`useBoard` reloads the whole board after a reconnect, a late first open of the stream, a
`column.changed` event and a failed card refresh (`src/components/board/use-board.ts:105-116`).
Those reloads ignore the drag and move hold that WS-048 section 5 puts on events, and are
not sequenced. So a reconnect during a drop can land the board as it was before the move,
the move's answer is then written into the old column (`use-board.ts:320-327`), and the
card is shown in column A while its `columnId` is B until the next full reload: the move's
own event carries the same version and is ignored as an echo. Two reloads in flight apply
in the order they land, so an older one can win; a task the viewer creates can appear
twice; and the task detail's changes are applied without the version rule.

After this item the board shows, at rest, what the server holds: one load at a time, only
the latest applied, none applied over a drag or a move, and every card in the column its
own `columnId` names.

## Acceptance criteria

- [ ] A reload asked for while a card is dragged or a move is saved (reconnect, late first
      open, `column.changed`, failed refresh) does not fetch; the board reloads once after
      the drag and the move have ended.
- [ ] A load already in flight when a drag or a move starts is not applied; the board
      reloads once after they end.
- [ ] Loads never run in parallel. Reloads asked for during a load cause exactly one more
      load after it, and only the last one is applied (also its error, if it fails).
- [ ] Events that arrive while a load is in flight are held and applied after it lands,
      with the version rule, so an event is neither lost nor overwritten by an older
      snapshot (this also covers the first load).
- [ ] After a successful move the returned task is shown in the column its `columnId`
      names: in place when the card is there, otherwise taken out of wherever it is and
      that column reloaded.
- [ ] `added(task)` does not show a task twice: when the board already holds it (its event
      landed first), it is replaced only if the answer's version is newer.
- [ ] A change from the task detail (`opanel:task-changed`) whose version is not newer than
      the card's is ignored.
- [ ] The failed-move reload, the 200-event overflow reload and every existing `useBoard`
      test keep their behavior.
- [ ] No API change. The full quality gate passes.

## Notes

Client only: `use-board.ts` and its test. Out of scope (the rest of B15): the project
frame's `setProject` without a version check (`project-events.tsx:59-62`, `board.tsx:65`)
and the missing "paused" line during the browser's own stream retries.
