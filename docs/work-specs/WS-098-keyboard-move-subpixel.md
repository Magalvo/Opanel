# WS-098 — A keyboard move works while the board is still animating

- Status: In progress (approved by the owner on 2026-11-20, questions 1 to 4 as recommended)
- Work-item: [WI-098](../work-items/WI-098-keyboard-move-subpixel.md)
- Canonical docs: [WS-037](WS-037-board-page.md) (board, drag and drop),
  [WS-054](WS-054-e2e-parallel-stability.md) (the keyboard collision rule and the keyboard
  test), [WS-082](WS-082-board-reload-ordering.md) (board reloads)

## Investigation

Done on 2026-11-20 on this 12-core Windows host (Node 24, pnpm 10.28.0, Compose PostgreSQL
on port 5433, database `opanel_flake_e2e_test`), on `main` at `7ac1f7b`. No test or app
code was changed. The probes were a scratch spec and temporary logging added to a private
copy of `@dnd-kit`'s files in this worktree's `node_modules`, all removed afterwards.

### 1. The symptom on CI

`board.spec.ts:208` carries Echo to the empty "In progress" column, drops it, picks it up
again, moves it back with ArrowLeft (`position 1 of 2`, checked stable by WS-054's
`settle()`), then presses ArrowDown and expects `position 2 of 2`. On CI (runs 44773683358
and 44783225994; in the first, the retry failed too) the live region stays at
`position 1 of 2` for the whole 5 s. The CI trace (its DOM snapshots, rebuilt from the
trace's incremental format) shows that the drag overlay does not move at all after
ArrowDown. The key was handled, but it went nowhere.

### 2. What is different on CI: the moves follow each other faster

On CI the first move's request takes about 50 ms, so the test picks Echo up again about
100 ms after the first drop. The first drop's 250 ms animation and Foxtrot's 200 ms slide
(back to the top of "To do") are then still running. The snapshots show two drag overlays
at once, the old one ending between ArrowLeft and ArrowDown. On this host the move request
is slower, everything has settled by the second pick-up, and the test passed every time:
20 of 20, also under a CPU load of 10 busy threads, and with ArrowDown pressed 20 to 400 ms
after ArrowLeft.

Slowing the page's animations through the DevTools protocol (`Animation.setPlaybackRate`)
recreates CI's overlap on this host: at a rate of 0.7, 2 of 8 runs failed exactly as on CI,
at 0.85 1 of 8, and with logging that writes to an in-page array (cheap enough not to hide
it), 5 of 30.

### 3. The cause: a measurement off by 0.00004 px

Logging inside `@dnd-kit` in a failing run:

| Key       | Dragged card's top (`collisionRect.top`) | Candidates "below" it, by their top                  | Target chosen                 |
| --------- | ---------------------------------------- | ---------------------------------------------------- | ----------------------------- |
| ArrowLeft | 240                                      | Foxtrot **239.99996**, the "To do" column 240        | Foxtrot: moves to y 239.99996 |
| ArrowDown | **239.99996**                            | Foxtrot 333, three columns 240, Echo's own place 240 | the "To do" column: y 240     |

1. At ArrowLeft, Foxtrot is still sliding up (its CSS transition from the first drop).
   `@dnd-kit` measures droppables "without their transform": it reads the element's box
   and undoes the transform that is applied at that instant. Mid-transition that sum leaves
   a rounding error: 239.99996 instead of 240.
2. `sortableKeyboardCoordinates` (`@dnd-kit/sortable` 10.0.0) moves the dragged card to the
   target's top-left corner, so the card's top is now 239.99996.
3. On ArrowDown it keeps the droppables whose top is **strictly** greater than the card's
   top. Everything at exactly 240 now qualifies: Echo's own place and the three column
   lists. The closest is Echo's own place, the current `over`, so `@dnd-kit` takes the
   second closest, the "To do" column, at y 240. The card moves by 0.00004 px, stays over
   its own place, and nothing new is announced.

With exact measurements (every run where the slide had ended), the only candidate below
240 is Foxtrot at 333 and the move works. This is a real defect, not a test-timing
problem: anyone who uses the keyboard quickly enough can hit it, and then that key does
nothing. It is not the board reload of WS-082 (the board holds reloads during a drag and a
move, and none ran), and it is not the WS-054 collision rule (`over` was right throughout).

### 4. Also seen, not part of this item

In the first 20-run batch, 4 runs failed differently: after `page.reload()` the board
was still "Loading the board…" when the 5 s `expect.poll` gave up. These were the first 4
tests on a freshly started `next start` (`/api/v1/me` took 2.4 to 3 s), with 4 workers.
This is server warm-up under load, the kind WS-054 section 2 describes, and CI never
showed it. It is recorded as a follow-up, not fixed here.

## Approach

### A. Droppables are measured to whole layout units

The browser lays pages out in 1/64 px units, so an exact measurement is always a multiple
of 1/64. The board gives `@dnd-kit` its own droppable `measure`: `@dnd-kit`'s
`getClientRect(element, { ignoreTransform: true })` (the default it replaces), with every
edge and size rounded to the nearest 1/64 px. A rounding error like 239.99996 becomes 240.
Real positions such as 514.5 are unchanged.

Since keyboard coordinates are built from droppable rectangles, they become exact too, and
`@dnd-kit`'s strict "below" comparison works again. Pointer collisions are unaffected: they
compare positions far more than 1/64 px apart.

- New `src/components/board/measure.ts`: `snapRect(rect)` (pure, the rounding) and
  `measureDroppable(element)` (`getClientRect` then `snapRect`).
- `board.tsx`: `measuring={{ droppable: { strategy: MeasuringStrategy.Always, measure:
measureDroppable } }}`, with the object moved to module scope (today it is a new object on
  every render).

**Considered and not chosen:**

- A keyboard coordinate getter of our own, comparing with a tolerance. It would copy
  about 80 lines of `@dnd-kit`'s `sortableKeyboardCoordinates` and keep it in step with
  the library. Rounding at the measurement fixes the input in one place (question 1).
- Rounding only the keyboard's coordinates. It fixes this case, but not a candidate whose
  own measurement is noisy (240.00004 would again count as "below" 240).
- Making the test wait for animations before each key. It would hide a real defect, as
  WS-054 judged for the keyboard collision rule.

### B. Tests

- `measure.test.ts`: `snapRect` rounds a rectangle measured mid-slide to whole layout
  units, and leaves exact ones (half pixels included) unchanged.
- `keyboard.test.ts` reproduces section 3 with `@dnd-kit`'s own
  `sortableKeyboardCoordinates`, fed the droppable rectangles logged on the host: raw, they
  send ArrowDown to the column. Passed through `snapRect`, they send it to Foxtrot. The
  first case is the documented cause. The second is the fix, and it fails until `snapRect`
  exists (red).
- `board.spec.ts` keeps its keyboard test unchanged. The slowed-animation probe of
  section 2 is run as verification only and not committed, since it needs the DevTools
  protocol and is not deterministic (question 2).

## Files

| Path                                    | Change                                                     |
| --------------------------------------- | ---------------------------------------------------------- |
| `src/components/board/measure.ts`       | create: `snapRect`, `measureDroppable`                     |
| `src/components/board/measure.test.ts`  | create: unit tests of the rounding                         |
| `src/components/board/keyboard.test.ts` | create: the ArrowDown case of section 3, raw and rounded   |
| `src/components/board/board.tsx`        | modify: the droppable `measure`, measuring at module scope |
| `docs/work-specs/WS-037-board-page.md`  | modify: one line in "Deviations" pointing here             |
| WI-098, WS-098                          | modify: statuses, implementation record                    |

No dependency, no migration, no API change. `docs/README.md` is changed only by index
commits on `main` (the reservation, and the follow-up of section 4).

## Data model changes

None.

## API contract

None.

## Test plan (written first, in this order)

| #   | Level | Test                                                                                                                                             | Covers criterion    |
| --- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| 1   | unit  | `keyboard.test.ts`: with the logged rectangles passed through `snapRect`, ArrowDown targets Foxtrot (red: no `measure.ts`)                       | ArrowDown mid-slide |
| 2   | unit  | `keyboard.test.ts`: with the raw logged rectangles, ArrowDown targets the column (documents the cause; passes before and after)                  | ArrowDown mid-slide |
| 3   | unit  | `measure.test.ts`: 239.99996 → 240, 333.00003 → 333; 514.5, 240.25 and a 238 × 86 size unchanged; right and bottom follow                        | whole layout units  |
| 4   | unit  | the existing `collision.test.ts`, `board.test.tsx` and `moves.test.ts` pass unchanged                                                            | unchanged           |
| 5   | e2e   | every `board.spec.ts` and `live-board.spec.ts` test passes unchanged                                                                             | unchanged           |
| 6   | e2e   | the keyboard test, 50 times with `--retries=0` (`--workers=2`, as on CI)                                                                         | stable              |
| 7   | e2e   | the scratch probe (the keyboard test with `Animation.setPlaybackRate` 0.7), 30 times with `--retries=0`: 30 of 30, against 3 of 24 failed before | stable              |
| 8   | gate  | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`                                                                                          | gate                |

## Risks and open questions

For the owner:

1. **Round the measurement, rather than copy `@dnd-kit`'s keyboard getter.** Rounding is
   about 15 lines in one place and also covers measurements the keyboard does not use.
   A copied getter with a tolerance would be about 80 lines to keep in step with the
   library. **Recommend: round (A).**
2. **No new end-to-end test.** The failure needs the previous drop to be still
   animating. The only reliable way to cause that is the DevTools protocol, and even then
   it reproduced in about 1 run in 8. The unit test of section B pins the exact
   values instead. **Recommend: unit tests, plus probe runs recorded in the implementation
   record.** The alternative is a `board.spec.ts` test that slows animations through CDP
   (Chromium only) and repeats the moves.
3. **Report it upstream.** `sortableKeyboardCoordinates` compares raw floats strictly. An
   issue to `@dnd-kit` with the numbers above costs nothing, but it is a public post.
   **Recommend: yes, by the owner, after the fix ships.** Not part of this item.
4. **The warm-up timeout of section 4** becomes a follow-up in `docs/README.md` (an index
   commit), not part of this item. **Recommend: as proposed.**
