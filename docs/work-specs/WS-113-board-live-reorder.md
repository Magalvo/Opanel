# WS-113 — A reorder within one column reaches an open board live

- Status: Done (approved by the owner on 2026-11-23, as proposed)
- Work-item: [WI-113](../work-items/WI-113-board-live-reorder.md)
- Canonical docs: [0002](../canonical/0002-realtime-sync.md) (live sync);
  [WS-048](WS-048-live-board.md) section 4 (applying events to the board);
  [WS-082](WS-082-board-reload-ordering.md) (moves and reloads);
  [WS-109](WS-109-backlog-page.md) section 6 (the same rule on the Backlog page)

## Approach

### 1. The defect

`useBoard` (`src/components/board/use-board.ts`) handles `task.created`, `task.restored`,
`task.updated` and `task.moved` alike: if the event is newer than the held version, it
calls `refreshTask(id)`, which fetches the task and calls `placeTask(task)`. `placeTask`
first tries `replaceInPlace` (`src/components/board/live.ts`), which succeeds whenever the
task is still in the column the board shows it in. For a reorder within one column it
does: the card's fields are replaced, its index is not, and the old order stays until a
reload. The task summary carries no position (WS-048 section 4: "`position` stays
private"), so the board cannot place the card itself; it has to read the column.

WS-048 section 4 already says what should happen: "`task.moved`: fetch the task, remove it
from the column it was in, reload its new column". The code follows the `task.updated` row
for every event. This spec brings it back to WS-048.

### 2. The change: an `ordered` flag, as on the Backlog page

The same shape as `use-backlog.ts` (WS-109 section 6), so the two hooks stay alike:

- `apply` passes `event.type !== "task.updated"` as `ordered` to `refreshTask`. That is
  `true` for `task.moved`, and also for `task.created` and `task.restored`, which today
  already end in a column read because the board does not hold the task (no change for
  them).
- `refreshTask(taskId, ordered)` keeps one fetch per task at a time. Its `again` set
  becomes a `Map<string, boolean>`: an event that arrives during a fetch ORs its `ordered`
  into the entry, so a `task.updated` arriving after a `task.moved` never downgrades the
  next fetch to an in-place one. The loop runs while the map holds an entry, exactly as
  `use-backlog.ts` does.
- `refreshOnce(taskId, ordered)` passes it on to `placeTask(task, { ordered })`.
- `placeTask(task, { ordered = false } = {})`: when `ordered` is `true`, it skips
  `replaceInPlace` and goes to the existing column read:
  `replaceColumn(removeTask(board, task.id), columnId, await listColumnTasks(...))`.
  Everything else (the version check, the backlog case `columnId === null`) is unchanged.

The board's own move calls `placeTask(moved)` without the option (WS-082: "in its own
column, whatever the board did meanwhile"). The board already shows the optimistic order,
and the server's order is the same, so it stays in place, as today. Events received during
the move are held (WS-048 section 5) and applied afterwards; the echo of the move itself
is ignored by the version rule.

### 3. Cost

One extra `GET .../tasks?columnId=` (every page, as the first load) per `task.moved` that
stays in its column. A move to another column already pays it today. Bursts are bounded by
the existing per-task fetch and by the held-events rule (more than 200 events reload the
whole board once).

### 4. Out of scope

- The task detail's live updates: it does not show a card's position.
- The Backlog page: already correct (WS-109 section 6).

## Files

| Path                                      | Change                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------- |
| `src/components/board/use-board.ts`       | modify: `ordered` through `apply`, `refreshTask`, `refreshOnce` and `placeTask` |
| `src/components/board/use-board.test.tsx` | modify: tests 1 to 4                                                            |
| `tests/e2e/live-board.spec.ts`            | modify: test 5                                                                  |
| `docs/work-specs/WS-048-live-board.md`    | modify: one line under "Deviations from the approved spec" pointing here        |
| WI-113, WS-113                            | modify: statuses, implementation record                                         |

No dependency, no migration, no API change. `docs/README.md` changes only by index commits
on `main`: the follow-up "A reorder within one column may not reach an open board live"
is marked answered by WI-113 once it is done.

## Data model changes

None.

## API contract

None.

## Test plan (written first, in this order)

| #   | Level | Test                                                                                                                                                                                   | Covers criterion |
| --- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit  | `use-board.test.tsx`, "other people's changes": a `task.moved` for a card that stays in its column reads that column and shows the server's order (`OPA-2` above `OPA-1`). Fails today | 1                |
| 2   | unit  | same block: the existing "replaces an updated card in place" test also asserts that no column was read for a `task.updated`                                                            | 2                |
| 3   | unit  | same block: with the task's fetch held open, a `task.moved` then a `task.updated` arrive; once the fetch ends, the follow-up fetch reads the column                                    | 3                |
| 4   | unit  | "moving": the board's own move within a column sends the move and reads no column afterwards                                                                                           | 4                |
| 5   | e2e   | `live-board.spec.ts`: two pages on one board; the first moves a card up within a column with the card menu (WI-111); the second shows the new order without a reload                   | 5                |

Test 1 is written and seen to fail before `use-board.ts` changes (AGENTS.md section 5).
Test 5 uses the card menu rather than a drag, which is the most reliable way to drive a
reorder from Playwright.

## Risks and open questions

1. `live-board.spec.ts` polls with a 2 s timeout and has been sensitive to load
   (two full end-to-end runs at once on one machine have failed it). Test 5 uses the
   suite's existing waiting helpers and adds no fixed sleep.
2. No other behaviour depends on a `task.moved` being applied in place: the only callers of
   `placeTask` are `refreshOnce` and the board's own move (checked in the code on
   2026-11-23).

## Deviations from the approved spec

1. **Test 2 needed no change.** The existing test "replaces an updated card in place when
   it stays in its column" already asserts that the only request is the task's `GET`
   (`taskGets()` counts column reads too), so it already covers criterion 2.

## Implementation record

- Red: in `use-board.test.tsx`, the reorder test and the test with an update after a move
  failed with the old order (`OPA-1`, `OPA-2`); the test of the board's own move passed, as
  expected for a guard (commit `7f3a091`).
- Green: `ordered` from `apply` through `refreshTask` (its `again` set became a map whose
  values are ORed), `refreshOnce` and `placeTask`, which skips `replaceInPlace` when it is
  set (commit `2146be2`).
- End to end: the new `live-board.spec.ts` test (commit `573b04e`) failed against the code
  before the fix and passed after; `live-board.spec.ts` 10 of 10.
- `WS-048-live-board.md` records the fix under its deviations (commit `5b5fa1c`).
- Gate: `typecheck`, `lint`, `format:check` pass; `test` 2186 of 2186 (213 files);
  `test:e2e` 114 of 114.
- Run on Windows 11 with Node 24.18.0 and pnpm 10.28.0 (corepack), against the Compose
  PostgreSQL on port 5433.
