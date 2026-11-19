# WS-082 — The board applies only the latest load, never during a move

- Status: Done (2026-11-19; approved by the owner the same day, questions 1 to 4 as proposed)
- Work-item: [WI-082](../work-items/WI-082-board-reload-ordering.md)
- Canonical docs: [0002](../canonical/0002-realtime-sync.md) section 4 (server is
  authoritative, own echo, reconnects); WS-048 sections 3 to 5; audit of 2026-11-19,
  finding B04

## Approach

### What happens today (read on 2026-11-19)

- `reload()` (`use-board.ts:105-116`) fetches and sets the board unconditionally. Its
  callers: the fallback timer (`:119-126`), `column.changed` (`:196-197`), a failed card
  refresh (`:172-173`), the 200-event overflow in `flush` (`:217-219`), a reconnect
  (`:247`), the first open (`:249-256`) and a failed move (`:329`). Only events are held
  during a drag or a move (`onEvent`, `:224-240`); reloads are not.
- The first-open effect runs once per mount, since `opened` never goes back to `false`
  (`project-events.tsx:69-73`): it meets a drop only when the stream opens after the
  fallback load. A reconnect can meet a drop at any time.
- A reload started _before_ a drag and landing during or after the move does the same
  harm as one started during it: the snapshot may predate the move.
- The move's success path (`:320-327`) writes the answer at `placeOf(latest, taskId)`,
  whatever column that is. When a pre-move snapshot landed first, the card stays in the
  old column with `columnId` of the new one; the move's `task.moved` event has the
  answer's version, so `isNewer` (`live.ts:11-13`) drops it as an echo.
- Two loads in flight both apply, in the order they land (fallback load and first-open
  reload; a burst of `column.changed`).
- An event that lands while a load is in flight is applied to the board the load is about
  to replace. During the first load the board is `{}`, so `replaceColumn` returns it
  unchanged (`live.ts:55`) and the event is lost if the snapshot was read before it.
- `added()` (`:298-304`) appends without looking: if the creation's event, its `getTask`
  and its column reload (`:133-152`) all land before the `POST` answer, the card shows
  twice.
- The task detail's `changed` handler (`:271-289`) replaces the card without comparing
  versions.

### The change (all in `use-board.ts`)

1. **One load at a time.** A `loader` ref: `{ running, again, generation, promise }`. An
   internal `load()` starts the loop when nothing runs, and otherwise sets `again` and
   returns the running `promise`. Each iteration clears `again`, takes
   `++generation`, and fetches. Its result (or its error, for `phase: "error"`) is applied
   only when the generation is still current and `again` is not set: a newer load is
   coming. The loop repeats while `again`; then `running` is cleared and `flush()` runs.
   A burst of reload requests costs at most two fetches.
2. **No reload over a hold.** The public `reload()` checks the hold first: while
   `dragging` or `moving`, it sets a new `held.current.reload` flag and returns. `flush`
   treats `reload` like `overflow` (queue dropped, one `reload()`). Every caller listed
   above keeps calling `reload()`, except the failed move, which calls `load()` directly
   (it owns the hold, and its reload must land before the announcement, as today).
3. **A hold supersedes a load in flight.** `supersede()`, called by `hold(true)` and at the
   start of `drop()` before `setBoard(after)`: `generation++`; if a load is running, clear
   `again` and set `held.current.reload`. The landing snapshot is then discarded and the
   board reloads after release.
4. **Events wait for a load.** `onEvent` and `flush` treat `loader.running` as a third
   hold reason, next to `dragging` and `moving`; the loop's end calls `flush()`. The held
   events then meet the new board through the version rule: an event the snapshot already
   holds is ignored, a newer one is fetched.
5. **The move's answer goes to its own column.** The tail of `refreshOnce` (`:144-152`:
   version check, `replaceInPlace`, else take the card out and reload its column with
   `listColumnTasks` + `replaceColumn`) becomes `placeTask(task)`, used by `refreshOnce`
   and by the success path of `drop`. Normally the card is in the answer's column and is
   replaced in place, so the index the user chose is kept (the existing test of
   `:158-186`). A failure of that column reload is caught there, not reported as a failed
   move, and asks for `reload()`, which runs after release.
6. **`added()` dedupes.** When `placeOf(current, task.id)` is not null, the card is
   replaced in place if `isNewer(held, task.version)`, else left; otherwise appended as
   today.
7. **The detail's changes obey the version rule.** `changed` returns early when
   `!isNewer(heldVersion(latest, task.id), task.version)`. The event that follows a save
   still carries the same version and is ignored (WS-048 section 6).

`reload` keeps its name and its returned promise, so `board.tsx` and its "Try again"
button do not change. No new pure helper is needed: `live.ts` already has `isNewer`,
`heldVersion`, `replaceInPlace`, `removeTask` and `replaceColumn`.

### Considered and not chosen

- **A generation counter alone.** It orders results but still sends a fetch per
  `column.changed` in a burst, and does not stop a load landing over a move.
- **Placing the answer by `position`.** `TaskSummary` has no `position` (WS-048,
  "Considered and not chosen"); the column reload of step 5 is the existing way.
- **Holding a card refresh that lands during a hold.** A `getTask` started before a drag
  can still land during it, as today. Step 5 corrects the moved card's column after the
  move; the rest stays as WS-048 accepted it (question 3).

## Files

| Path                                      | Change                                          |
| ----------------------------------------- | ----------------------------------------------- |
| `src/components/board/use-board.ts`       | modify: steps 1 to 7                            |
| `src/components/board/use-board.test.tsx` | modify: new tests (first), a deferred-fetch aid |
| `docs/README.md`, WI-082, WS-082          | modify: statuses; B04 and part of B15 resolved  |

No dependency, no migration, no change to `board.tsx`, `live.ts` or `moves.ts`.

## Data model changes

None.

## API contract

None.

## Test plan (written first, in this order)

All in `use-board.test.tsx`, with its existing harness: `FakeSource` for the stream
(`drop()`, `open()`, `send()`), the `fake-api` fetch keyed by "METHOD url", and the
pending-promise pattern of `:158-163`. A small test-local aid, `deferNext(key)`, makes the
next request for `key` wait until the test answers it; later requests answer from `on()`.
A helper `consistent(board)` checks that every card's `columnId` is the column it is in.

| #   | Level | Test                                                                                                                                                                                                                                                                                    | Covers criterion          |
| --- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| 1   | unit  | `it.each` reconnect / first open after the fallback load: during a pending move of OPA-2 to "In progress", the trigger makes no columns `GET`; the move answers `v5`, `TASKS` now answers the moved board; then exactly one load runs, OPA-2 is in "In progress" and `consistent` holds | no reload over a hold     |
| 2   | unit  | the same with `TASKS` still answering the pre-move board during the move: before the fix OPA-2 ends in "To do" with `columnId` of "In progress" (fails: `consistent` is false)                                                                                                          | no reload over a hold     |
| 3   | unit  | `column.changed` with its `TASKS` deferred, then `hold(true)`; the deferred answer (old board) lands: the board is unchanged; `hold(false)`: one more load, its board shown                                                                                                             | load in flight superseded |
| 4   | unit  | three `column.changed` while the first load's `TASKS` is deferred: two loads in total, the second's board shown                                                                                                                                                                         | one load at a time        |
| 5   | unit  | fallback load with `TASKS` deferred; the stream opens; `on(TASKS)` now answers a newer board; the deferred one then answers the old board: the newer board is shown (fails before: the old one wins)                                                                                    | only the last applies     |
| 6   | unit  | a first load that fails while a second is asked for: no `phase: "error"`, the second's board shown                                                                                                                                                                                      | only the last applies     |
| 7   | unit  | during a deferred load, `task.updated` for OPA-1 `v2`: no `getTask` until it lands; snapshot holds `v2` → no fetch; snapshot holds `v1` → one fetch, card updated                                                                                                                       | events wait for a load    |
| 8   | unit  | first load deferred; `task.created` for OPA-4 arrives; the snapshot (read before) lacks it: after landing OPA-4 is shown (fails before: lost)                                                                                                                                           | events wait for a load    |
| 9   | unit  | a refresh of OPA-2 (`getTask` deferred) in flight when OPA-2 is dropped in "In progress"; it lands with OPA-2 `v5` in "To do", its column reload puts it back there; the move answers `v6` in "In progress": OPA-2 ends in "In progress" `v6`, `consistent` holds                       | answer to its own column  |
| 10  | unit  | `task.created` for OPA-4 refreshed onto the board, then `added(OPA-4 v1)`: shown once; `added` with a newer version replaces it                                                                                                                                                         | `added` dedupes           |
| 11  | unit  | `opanel:task-changed` for OPA-2 titled "Renamed" with `version: 3` or `4` (held `4`): board unchanged (fails before)                                                                                                                                                                    | detail version rule       |
| 12  | unit  | existing tests kept: failed-move reload and announcement, 200-event overflow, reconnect reload, first-open load, "Try again"                                                                                                                                                            | no regression             |
| 13  | gate  | `typecheck`, `lint`, `format:check`, `test`, `test:e2e` (`board.spec.ts`, `live-board.spec.ts` as regression)                                                                                                                                                                           | gate                      |

No new E2E test: a reconnect landing inside a move's round trip cannot be timed
deterministically in a browser (question 2).

## Risks and open questions

For the owner:

1. **Holding events while a load is in flight (step 4) is a small widening** of WS-048
   section 5, which holds them only for a drag or a move. Without it the first-load loss
   (test 8) stays. **Recommend: include, and amend WS-048 section 5 by a line in this
   item's implementation record.**
2. **No E2E test.** The unit tests drive the hook with the real fetch path and a fake
   stream, which is where the ordering lives. **Recommend: unit tests only.**
3. **A card refresh in flight when a drag starts** can still change the board under the
   drag (as before this item); only the moved card is corrected. **Recommend: leave it,
   and record it as a lower follow-up.**
4. **The project frame's version checks (rest of B15)** are a different component with
   its own tests. **Recommend: a separate small item with the "paused" line.**

## Deviations from the approved spec

1. **A `column.changed` that arrives during a load is not held** with the other events:
   it asks for one more load at once (`again`), so a burst costs two loads as test 4
   requires. Held behind a drag or a move, a `column.changed` among the held events makes
   the release load the whole board instead of applying the queue, like the overflow.
2. **The load loop calls `flush` through a ref** (`flushHeld`), set in an effect, since
   `flush` is declared after `load` and depends on it through `reload`.
3. **`askedAgain(loader)`** reads `again` through a function after the `await`, for the
   same reason as `isMounted`: the type checker would otherwise narrow it to `false`.
4. **Tests 1 and 2 are each run for both triggers** (reconnect, first open after the
   fallback load), and tests 5 and 8 let the competing request finish before releasing the
   held one, so that they fail for the right reason before the change.

## Amendment to WS-048 section 5 (owner's question 1)

Events are held while a load is in flight too, not only during a drag or a move. They are
applied once the snapshot lands, with the version rule.

## Implementation record

- Red: 15 new cases (tests 1 to 11, tests 1, 2, 7 and 11 parametrised) failed on their
  assertions: a load during the move, a card in the wrong column, a stale snapshot shown,
  four loads for a burst, `phase: "error"` from a replaced load, a `getTask` during a load,
  a lost `task.created`, a duplicated card, a detail change applied with an old version.
- Green: 96 of 96 board tests, the 33 existing `useBoard` cases unchanged (test 12).
- Test 13: the full E2E suite 87 of 87. `board.spec.ts` and `live-board.spec.ts` with
  `--repeat-each=3`, twice: 38 of 38 both times. In one earlier loaded run the keyboard
  move test (`board.spec.ts:208`) failed twice on "position 2 of 2"; the base, without
  this item, failed it once in two identical runs. It is the timing flake of audit finding
  B11 (`settle()` waits 200 ms), not a change of this item.
- Gate on 2026-11-19:
  - typecheck, lint and Prettier pass;
  - Vitest 1561 of 1561;
  - `pnpm test:e2e --retries=0` 87 of 87;
  - Linux, Node 22.23.5, pnpm 10, Compose PostgreSQL 18 on port 5432.
