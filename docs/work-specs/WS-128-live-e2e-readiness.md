# WS-128 — The live end-to-end tests wait for what they measure

- Status: Done (approved by the owner on 2026-11-25, with the recommended answers to its
  open questions; done on 2026-11-25)
- Work-item: [WI-128](../work-items/WI-128-live-e2e-readiness.md)
- Canonical docs: [0002](../canonical/0002-realtime-sync.md) (events are not replayed; a
  page reloads on open and after a reconnect); WS-048 (the live board and its end-to-end
  tests), WS-109 (the backlog's "Move to board", which sends the row's version), WS-123
  (the board's live logic on `main`)

## Approach

### 1. Investigation (on `main`, `3eca4b5`, 2026-11-25)

Runs of `live-board.spec.ts`, `planning-flow.spec.ts` and `backlog.spec.ts` together, on
this Windows machine with the Docker PostgreSQL. A failing run's `trace.zip` was kept
before the next run and read with a small script listing each page's `/api/` requests in
time order (request and answer bodies included). The traces and logs below are kept in the
session notes folder (`WI-128-traces`), outside the repository.

| Run | Workers | Repeats | Result                                                  |
| --- | ------- | ------- | ------------------------------------------------------- |
| 1   | 4       | 5       | 57 passed                                               |
| 2   | 6       | 15      | 21 failed, 146 passed: the two follow-ups, and overload |
| 3   | 6       | 15      | the delete test probed (below): 5 failed, 162 passed    |

Run 1, at the configured 4 workers, did not reproduce either failure; 6 workers did,
often enough to read. Run 2's other failures are overload (a page not visible after 5 s, a
drag cut off when the test timed out) or the board's slow load after a reload, which has
its own follow-up (`backlog.spec.ts:162`, an empty list 5 s after `page.reload()`).

#### `planning-flow.spec.ts:101`: the move is refused, as designed

Failed in 6 of 15 (run 2) and 1 of 15 (run 3). In every one of the 6 traces of run 2:

1. The second tab saves the task detail (`PATCH /tasks/{key}-1`): priority, due date and
   label, one write, so version 1 becomes 2. Its `task.updated` event reaches the backlog
   page, which reads the task again (`GET /tasks/{id}`), as WS-109 says.
2. The test closes the tab and clicks "Move to board" at once. The click lands while that
   read is in flight or just answering (the `POST …/move` starts before the read answered
   in three traces, and 12 to 14 ms after it in the other three), so `moveToBoard`
   sends the version the row still holds: `{"columnId": …, "version": 1}`.
3. The move answers `409 version_conflict` with `current.version` 2. The backlog does what
   WS-109 asks of a refused move: it reloads (the task is still in the backlog) and says
   "Someone else changed {key}-1. The backlog was refreshed." The test then waits 5 s for
   a list that will not change.

No event is missed: the backlog applied the update right after, and its reload shows the
server's state. The race is in the test, which clicks before the page holds what the
other tab saved. A person who did the same would see the same message, which is the
intended answer to a stale write.

#### `live-board.spec.ts:153`: the 2 s include the delete itself

Failed in 4 of 15 at line 153 (and once at line 150, overload) in run 2. The test clicks
"Delete" and polls board `b` for 2 s at once, while the move test waits for `/move` to
answer before its own 2 s. In the traces, the `DELETE /tasks/{key}-1` took 1387 ms and
1589 ms, and in two failures it had not answered when the test ended, while board `b`'s
stream (`/events`, `200`) and first load had finished seconds earlier. Under load, the
delete took most or all of the 2 s.

Run 3 probed it, with an uncommitted change to the test: wait for the `DELETE` answer,
then poll board `b` every 20 ms for up to 15 s, and print both times. In 15 of 15 the card
left board `b`:

| Measure                                    | Min    | Max     |
| ------------------------------------------ | ------ | ------- |
| `DELETE` answer, from the click            | 503 ms | 2119 ms |
| card gone from board `b`, after the answer | 112 ms | 930 ms  |

So board `b` receives `task.deleted` and applies it; it was the test's clock that started
too early.

The suspects of the follow-up are ruled out:

- **An event published before the stream subscribed.** `openEventStream` subscribes to
  the hub before it answers (WS-047), and both tasks exist before either board opens: the
  only event board `b` needs comes seconds after its stream answered `200` and its first
  load ended. Its first load starts on the stream's open (`opened`), so anything committed
  before is in that load.
- **The hub delivering late.** In run 3's restore step (below), board `b` starts reading
  the restored task 3 to 137 ms before `a`'s `POST …/restore` has even finished answering:
  the notification arrives at commit.
- **The test's readiness condition.** `openBoard` waits for the `/events` answer, which is
  sent after the subscription, so it does mean "subscribed". The board's first load may
  still run when the test acts, but an event during it is held and applied after it
  (`onEvent` and `flush` in `use-board.ts`, covered by the unit tests of WS-082).

#### What run 3 showed next: the restore step under 6 workers

With the delete check fixed by the probe, the same test failed 3 of 15 in run 3 at its
restore check (line 164), which already waits for the restore's answer (the status message
on page `a`). Board `b` got `task.restored` at once (above) and did what WS-048 section 4
asks: it read the task, then its column. Under 6 workers those two reads, one after the
other, ended 1.30 s, 1.72 s and 2.05 s after the restore's answer, which leaves little or
nothing of the 2 s. This is load on a page that does two requests, not a missed event and
not a test that starts its clock early; it is not seen at the configured 4 workers. It is
question 1.

### 2. `planning-flow.spec.ts`: move once the backlog shows the saved change

After `await detail.close();`, before the click on "Move to board":

```ts
// The backlog shows what the detail saved, so its move sends the version it holds now
// (WS-128): clicked earlier, the move is refused as a stale write.
await expect(
  backlog(member)
    .getByRole("listitem")
    .filter({ hasText: "Plan the release" })
    .getByRole("img", { name: "Priority: High" }),
).toBeVisible();
const sent = member.waitForResponse((response) => response.url().endsWith("/move"));
await member.getByRole("button", { name: `Move to board ${key}-1` }).click();
expect((await sent).status()).toBe(200);
```

The priority and the version change in the same write, so the row showing "Priority: High"
means it holds version 2. The check on the move's status makes a refused move fail at that
line, with the reason, instead of 5 s later on the list. The default 5 s of the poll at
line 101 stays.

### 3. `live-board.spec.ts`: start the 2 s once the delete is saved

In "a deleted task disappears from the other board, and comes back when restored":

```ts
const deleted = a.waitForResponse(
  (response) =>
    response.request().method() === "DELETE" && response.url().endsWith(`/tasks/${key}-1`),
);
await a.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
expect((await deleted).status()).toBe(204);

await expect.poll(() => titlesIn(b, "To do"), { timeout: 2_000 }).toEqual(["Foxtrot"]);
```

The 2 s now measure what the test names: a change made elsewhere reaching an open board.
The restore step is unchanged (question 1).

### 4. Red, then green, deterministically

Load alone reproduces these failures only now and then, so each is first made certain by
delaying, in the test, the one request whose timing it depends on. The delay is a
temporary line, not committed, and the implementation record shows both runs:

- **Planning.** `member.route("**/api/v1/tasks/*", …)` delays the backlog page's
  `GET /tasks/{id}` by 1.5 s (`route.continue()` after a wait; other methods pass at
  once). The test as it is on `main` fails at line 101, and its trace shows the `409`.
  With section 2, the same run passes: it waits for the row before clicking.
- **Delete.** `a.route("**/api/v1/tasks/*", …)` delays the `DELETE` by 2.5 s. The test as
  it is fails at line 153; with section 3 it passes.

Then the delay is removed and the load runs of section 5 are repeated.

### 5. Evidence under load

After the change, `corepack pnpm test:e2e tests/e2e/live-board.spec.ts
tests/e2e/planning-flow.spec.ts tests/e2e/backlog.spec.ts --repeat-each=15`, at the
configured 4 workers, once on its own: the counts of each test go into the record, with any
failure's line and trace read as in section 1. The same at 6 workers is recorded too, for
comparison with runs 2 and 3, without being a criterion (the configuration says 4, for
the reason of WS-054).

### Alternatives not taken

- **A longer wait** at lines 101 and 153: forbidden by hard rule 3, and it would hide the
  `409` the planning test hits.
- **"Move to board" sends the newest version, or retries after a `409`**: it would move a
  task someone else just changed without the person seeing that change, which WS-109's
  version check exists to prevent.
- **A wait for `networkidle`**: the open event stream keeps the network busy, and it would
  not say which state the test needs.

## Files

| Path                              | Change                                              |
| --------------------------------- | --------------------------------------------------- |
| `tests/e2e/planning-flow.spec.ts` | modify: wait for the saved change, check the move   |
| `tests/e2e/live-board.spec.ts`    | modify: wait for the delete's answer before the 2 s |
| `docs/work-items/WI-128-…`        | modify: status and criteria                         |
| `docs/work-specs/WS-128-…`        | modify: status, implementation record, deviations   |

No application code changes.

## Data model changes

None.

## API contract

None.

## Test plan (written first, in this order)

| #   | Level | Test                                                                                                            | Covers criterion |
| --- | ----- | --------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | e2e   | `planning-flow.spec.ts` with the backlog's task read delayed (temporary): fails at line 101 with a `409`, as is | 3                |
| 2   | e2e   | the same with section 2: passes, the move answering `200`                                                       | 1, 3             |
| 3   | e2e   | `live-board.spec.ts`'s delete test with the `DELETE` delayed (temporary): fails at line 153, as is              | 3                |
| 4   | e2e   | the same with section 3: passes                                                                                 | 2, 3             |
| 5   | e2e   | the three specs `--repeat-each=15` at 4 workers, then at 6 for comparison (section 5)                           | 5                |
| 6   | all   | the quality gate                                                                                                | 4, 6             |

No unit test is added: no application code changes, and the board and backlog behaviour
the tests rely on is already covered (WS-082's "does not lose an event that arrives during
the first load", WS-109's refused move that reloads and explains).

## Risks and open questions

Both questions were answered by the owner on 2026-11-25 as recommended: the restore step is
left to a follow-up, and the archive test is left alone.

1. **The restore step at heavier load than configured.** At 6 workers it failed 3 of 15
   because board `b` reads the task, then its column, before showing it (section 1). It is
   not seen at 4 workers. Recommended: leave it, and record the measurements as a
   follow-up: if it fails at 4 workers or in CI, a work-item could let a task event name
   its column, so a restored or moved task needs one read instead of two (an event
   contract change, doc 0002). Alternatively, this item could take it now; that is an
   application change and would need this spec revised.
2. **Other tests with the same shape.** The archive test of `live-board.spec.ts` also
   starts its 2 s at a click, without waiting for the answer; it did not fail in runs 1 to 3. Recommended: leave it (one work-item, the two follow-ups); if the owner prefers, it
   gets the same `waitForResponse` here, under the same criterion as section 3.

## Deviations from the approved spec

None. The comments of the two tests say why each wait is there and name WS-128.

## Implementation record

- Red, deterministic (plan tests 1 and 3, 2026-11-25, temporary `page.route` delays as in
  section 4, never committed): both tests failed at the follow-ups' lines. Planning: "Plan
  the release" still in the backlog after 5 s, and its trace shows the `PATCH` answering
  `200`, then `POST …/move` answering `409`. Delete: board `b` still showed "Echo" after
  2 s.
- Green (plan tests 2 and 4): with sections 2 and 3 and the same delays, both passed. The
  delays were then removed.
- Under load (plan test 5), `live-board.spec.ts`, `planning-flow.spec.ts` and
  `backlog.spec.ts` with `--repeat-each=15` (167 tests):

  | Workers | Result               | The two checks of this item | Other failures                                    |
  | ------- | -------------------- | --------------------------- | ------------------------------------------------- |
  | 4       | 166 passed, 1 failed | 0 of 15 each                | "a task created through the API…", line 141       |
  | 6       | 165 passed, 2 failed | 0 of 15 each                | the restore step (line 166); a `500` on `/events` |
  - **The create test at 4 workers.** Its `POST /tasks` answered `201`; board `b` read the
    task at once, then its column (`GET …/tasks?columnId=…`, 1.2 s under load), and the card
    showed about 2 s after the answer. It is question 1's two reads, here at the configured 4
    workers and in another test, so the follow-up records it.
  - **The restore step at 6 workers**: 1 of 15 (3 of 15 in run 3), question 1.
  - **The `500` at 6 workers**: `backlog.spec.ts:75`, the stream of `openBacklog`; the
    server logged `AggregateError code=ETIMEDOUT`, a database connection to `localhost:5433`
    not made in time, so overload of this machine's Docker PostgreSQL above the configured
    workers.

  The logs and traces are in the session notes folder (`WI-128-traces`, `after-*`).

- Gate on the branch: `pnpm check` passed; `pnpm test` 2413 of 2413 (229 files);
  `pnpm test:e2e` 123 of 123.
- Follow-up recorded on `main`: a task event that names its column, so a board shows a
  created, restored or moved task with one read instead of two (question 1, with the
  measurements above).
