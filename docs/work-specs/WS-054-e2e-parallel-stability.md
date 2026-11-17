# WS-054 — A keyboard move lands where it was announced, and the suite is stable in parallel

- Status: Proposed
- Work-item: [WI-054](../work-items/WI-054-e2e-parallel-stability.md)
- Canonical docs: [WS-037](WS-037-board-page.md) (board, drag and drop, the collision
  rule), [WS-007](WS-007-e2e.md) (Playwright), [WS-052](WS-052-e2e-admin-isolation.md)
  ("Deviations", where the failures were recorded)

## Investigation

Done on 2026-11-17 on this 12-core Windows host (Node 24, pnpm 10.28.0, Compose
PostgreSQL on port 5433, a database of its own, `opanel_wi053_e2e_test`), on `main` at
`f99a22e`. No test or app code was changed; the diagnostics below ran from a scratch spec
that was deleted afterwards.

### 1. The keyboard move: a real race in the app

The test (`tests/e2e/board.spec.ts:172`) carries Echo from "To do" to the empty "In
progress" column, then back with ArrowLeft into "To do", which holds Foxtrot. It waits for
the live region to contain `is in To do`, presses Space, and expects `["Foxtrot", "Echo"]`.

A scratch copy of the test logged the live region and the move request:

| Moment                            | Live region                                |
| --------------------------------- | ------------------------------------------ |
| just after `is in To do` appears  | `…-1 is in To do, position 2 of 2.`        |
| about 40 ms later, no key pressed | `…-1 is in To do, position 1 of 2.`        |
| the move request                  | `beforeTaskId` = Foxtrot                   |
| after the drop                    | `…-1 was moved to To do, position 1 of 2.` |

In 12 probe runs with one worker, the first reading was `position 2 of 2` in 8 and
already `position 1 of 2` in 4; by the time Space was pressed it was `position 1 of 2` in
all 12, and the 6 that pressed Space then failed as in WS-052. The unmodified test passed
11 of 11 alone with one worker, and failed 11 of 12 when only this test ran in 6 workers. So the test passes only when Playwright presses Space before
the board changes its mind, which a busy machine prevents.

**Why the target moves.** A keyboard drag has no pointer (`@dnd-kit/core` 6.3.1 computes
pointer coordinates only from mouse and touch events), so the board's collision detection
(`board.tsx`, WS-037 "Deviations") falls back to `closestCorners` over every droppable.

1. ArrowLeft: `sortableKeyboardCoordinates` puts the dragged card at the top-left corner
   of the target. The "To do" column's droppable (the `min-h-16` list wrapper) and the
   Foxtrot card share that corner, and while the column holds one card they are also the
   same size, so both are at distance 0. The tie goes to the column (observed; the order
   of equal distances is `@dnd-kit`'s): over = column,
   announced as the end of the column, "position 2 of 2".
2. `onDragOver` moves Echo into the preview at the end of "To do"; the column grows to two
   cards and is re-measured (`MeasuringStrategy.Always`).
3. The collision runs again on the new rectangles: Foxtrot still sits exactly under the
   dragged card, the taller column no longer does. Over = Foxtrot, "position 1 of 2".

The same happens for any keyboard move into a column with exactly one card. With two or
more cards the column is taller than a card from the start, the first card wins at once,
and nothing moves. A screen reader user hears a place, then another one; the drop goes to
the second.

### 2. The other end-to-end failures: load on this machine

- In the 6-worker runs of the probe, every test that timed out spent its 30 s in
  `page.goto` of the board. The trace shows the page's JavaScript chunks taking 5 to 29 s
  each from `next start` (one Node process, compressing and serving the same chunks to
  six fresh browser contexts). Host CPU was at 87 % at the time, partly from another
  session's lint.
- The `accessibility.spec.ts:59` failures recorded in WS-052 ("element not found" for the
  Comments region and the epic dialog, then 30 s timeouts) are content rendered on the
  client, waiting for those chunks. This one test visits six pages and opens two dialogs,
  with an axe scan each, inside one 30 s budget: the longest test of the suite.
- The `task-detail`, `epics`, `projects` and `profile` timeouts appear only with the
  default 6 workers, never with 4 (WS-052, "Deviations").
- **CI does not see any of them.** The last 40 successful runs of `.github/workflows/ci.yml`
  (`ubuntu-latest`, Playwright's default of 2 workers, `retries: 1`) show no `flaky` or
  `failed` end-to-end line: no retry was needed, the keyboard test included.

Judgement: apart from the keyboard move, these are load, not races between tests. They
need a smaller local worker count and a shorter accessibility test, not app changes.

### 3. `routes.test.ts` "finds the route files"

It is the first test of its file to call `exportedHandlers()`, which imports every route
module (and through them most of `src/server`) for the first time. It pays the whole
transform and import cost; the later tests in the file reuse the module cache. Under full
Vitest load that is just over the 5 s default (5.08 s in WS-052). Not a bug.

## Approach

### A. The board: the keyboard uses the same rule as the pointer

WS-037's rule for a pointer is: the cards under the pointer first; over a column but no
card, the column's closest card, or the column itself when empty. Without a pointer the
board uses **the centre of the dragged card** as the point, and applies the same rule.

- ArrowLeft into "To do": the centre is on Foxtrot. Over = Foxtrot, "position 1 of 2".
  The preview puts Echo above Foxtrot; the centre is now on Echo's own place, which
  `targetOf` reads as the same place, so nothing new is announced and the drop keeps
  position 1.
- ArrowRight into an empty column: the centre is inside the column's list (`min-h-16`),
  with no card. Over = the column, "position 1 of 1", as today.
- ArrowUp and ArrowDown within a column: the card is moved onto the next card, whose
  place the centre is then on, as today.

The collision function moves out of `board.tsx` into `src/components/board/collision.ts`
so that it can be unit-tested with plain rectangles. It keeps its two inputs from the
component: how to tell a column target, and where a card is in the board as shown.

**Considered and not chosen:** a test that waits for the board to settle before Space.
It would make the test green and leave the announcement that changes by itself.
Landing at the **end** of the column would need a keyboard coordinate getter of our own;
WS-037 uses `@dnd-kit`'s, and position 1 is what people get today (question 1).

### B. The keyboard test checks the announcements

`board.spec.ts`, "a Member moves a card by keyboard only": before ArrowLeft, a
`MutationObserver` on the `@dnd-kit` live region records every text it shows. After
ArrowLeft the test waits two animation frames and 200 ms, then expects the recorded
texts to be exactly `["<key> is in To do, position 1 of 2."]`. Then ArrowDown, wait for
`position 2 of 2.`, Space, `was moved to To do, position 2 of 2.`, reload, and the same
final assertions as today (`["Foxtrot", "Echo"]` on the page and through the API).

### C. The accessibility check of the projects pages, split

`accessibility.spec.ts:59` becomes three tests per colour scheme, each seeding its own
Manager and project through the existing calls:

1. the projects list, the board, the task page and the project settings;
2. the epics page and an epic's dialog;
3. the task as a dialog over the board.

The pages, the axe tags and the assertions stay the same; only the grouping changes.

### D. At most 4 workers locally

`playwright.config.ts`: `workers: isCI ? undefined : 4`, with a comment pointing here.
CI keeps Playwright's default (2 on `ubuntu-latest`). `CONTRIBUTING.md` gets one line:
more workers can be asked for with `--workers`, at the cost of timeouts on a busy machine.

### E. `routes.test.ts` loads the route modules once

The handlers are loaded in a `beforeAll` with a 30 s limit, and the tests read the
loaded list. Every assertion stays; the import cost is no longer charged to whichever
test runs first.

### Out of scope

- Why `next start` serves static chunks so slowly under parallel load (compression on
  the main thread is the likely cause, not measured). The end-to-end server is the
  production build on purpose (WS-007).
- A database or server per worker (WS-052, question 1).
- CI's `retries: 1` (WS-052, question 2).

## Files

| Path                                     | Change                                                  |
| ---------------------------------------- | ------------------------------------------------------- |
| `src/components/board/collision.ts`      | create: the board's collision rule, keyboard included   |
| `src/components/board/collision.test.ts` | create: unit tests with plain rectangles                |
| `src/components/board/board.tsx`         | modify: uses `collision.ts`                             |
| `tests/e2e/board.spec.ts`                | modify: the keyboard test as in B                       |
| `tests/e2e/accessibility.spec.ts`        | modify: the projects check split as in C                |
| `playwright.config.ts`                   | modify: at most 4 workers outside CI                    |
| `src/lib/openapi/routes.test.ts`         | modify: route modules loaded once in `beforeAll`        |
| `CONTRIBUTING.md`                        | modify: one line on local workers                       |
| `docs/work-specs/WS-037-board-page.md`   | modify: the keyboard collision line points to this spec |
| `docs/README.md`, WI-054, WS-054         | modify: statuses                                        |

No dependency, no migration, no API change.

## Data model changes

None.

## API contract

None.

## Test plan (written first, in this order)

| #   | Level | Test                                                                                                                                                                  | Covers criterion   |
| --- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 1   | e2e   | `board.spec.ts` keyboard test as in B; on today's board it fails because the recorded texts are `position 2 of 2`, then `position 1 of 2` (red, run and seen failing) | no self-change     |
| 2   | unit  | `collision.test.ts`: no pointer, the dragged card's corner on a column with one card of the same size → the card, not the column                                      | no self-change     |
| 3   | unit  | the same after the column has grown to two cards with the dragged card in the first place → the dragged card's own place (the same place as in 2)                     | no self-change     |
| 4   | unit  | no pointer, the dragged card over an empty column → the column                                                                                                        | empty column       |
| 5   | unit  | no pointer, the dragged card on the next card of its own column → that card                                                                                           | within a column    |
| 6   | unit  | with a pointer: on a card → the card; on a column but no card → its closest card; on an empty column → the column (today's rule, kept)                                | pointer as today   |
| 7   | e2e   | the other `board.spec.ts` tests pass unchanged                                                                                                                        | pointer as today   |
| 8   | e2e   | the keyboard test 20 times with `--workers=6 --retries=0`                                                                                                             | stable             |
| 9   | e2e   | `accessibility.spec.ts`: the three projects tests per scheme, with the same pages and dialogs as before                                                               | split, no loss     |
| 10  | e2e   | `playwright test --list` and a run without `--workers` report 4 workers locally                                                                                       | workers            |
| 11  | unit  | `routes.test.ts`: all its tests pass, the loading in `beforeAll`                                                                                                      | load once          |
| 12  | e2e   | the full suite three times with `--retries=0`, on this machine, recorded with the host's load at the time                                                             | stable in parallel |
| 13  | gate  | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`                                                                                                               | gate               |

## Risks and open questions

For the owner:

1. **Where a keyboard move into another column lands.** At the top of the column
   (position 1), which is where `@dnd-kit`'s keyboard coordinates put it and what a person
   gets today; or at the end, which needs our own coordinate getter. **Recommend: the
   top; one ArrowDown per card goes lower, as within a column.**
2. **Fix the app, not only the test.** The test alone could wait for the board to settle;
   that would hide an announcement that changes by itself. **Recommend: fix the
   collision rule (A) and make the test catch the change (B).**
3. **4 workers locally.** The quality gate's `pnpm test:e2e` would then pass on a busy
   12-core machine; a faster idle machine is slowed down a little. CI is unchanged.
   **Recommend: `workers: isCI ? undefined : 4`.** The alternative is no config change and
   a line in `CONTRIBUTING.md` asking for `--workers=4`.
4. **Splitting the accessibility test** adds two sign-ins and two project setups per
   colour scheme (about a second each), and makes each test short enough for 30 s.
   **Recommend: split, rather than `test.slow()` on one long test.**
5. **Acceptance on a shared host.** Other sessions on this machine (lint, builds, other
   suites) change the result of test 12. **Recommend: run test 12 when no other suite or
   build runs, and record the load in the implementation record.**
6. **The branch is stacked on WI-052** (`claude/wi-052-e2e-isolation`), for
   `playwright.config.ts` and the docs index. Its pull request follows WI-052's.
   **Recommend: as proposed.**
