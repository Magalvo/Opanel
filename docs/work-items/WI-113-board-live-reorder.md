# WI-113 — A reorder within one column reaches an open board live

- Status: In progress
- Work-track: none: a follow-up of WI-109 (WS-109, "Observation for the owner"), confirmed in
  the code by the project audit of 2026-11-23
- Depends on: none
- Work-spec: [WS-113](../work-specs/WS-113-board-live-reorder.md)

## Outcome

When someone else moves a card to another place in the same column (by dragging, with the
keyboard or with the card's menu), every other open board shows the new order without a
reload. Today such a `task.moved` event is applied in place: the card's fields are
refreshed but it keeps its old position until the page is reloaded, although WS-048
section 4 says a `task.moved` reloads the task's column. A move to another column, and
every other event, behaves as today.

## Acceptance criteria

- [ ] On an open board, a `task.moved` event for a card that stays in its column reads that
      column again (`GET /api/v1/projects/{key}/tasks?columnId=`) and shows the cards in
      the order the server returns.
- [ ] A `task.updated` event for a card that stays in its column still replaces the card in
      place, without reading the column.
- [ ] When a `task.updated` and a `task.moved` for the same task arrive while that task is
      being fetched, the fetch that follows still reads the column again.
- [ ] The board's own move (the person's drag, keyboard move or menu move) still places the
      returned task in place, without reading the column again.
- [ ] Two people on the same board: when one reorders a card within a column, the other
      sees the new order without reloading (end to end).
- [ ] Every existing board unit and end-to-end test passes unchanged.
- [ ] The full quality gate passes.

## Notes

The Backlog page already handles this correctly: `use-backlog.ts` passes an `ordered` flag
from the event type to its task refresh (WS-109 section 6). This item gives the board the
same rule. No API, data model or server change.
