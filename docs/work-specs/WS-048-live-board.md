# WS-048 — Live board

- Status: Done (approved by the owner on 2026-11-18, questions 1 to 6 as proposed)
- Work-item: [WI-048](../work-items/WI-048-live-board.md)
- Canonical docs: [0002](../canonical/0002-realtime-sync.md) (sections 3 and 4: thin
  events, refetch, the echo rule, reload after a reconnect);
  [WT-04](../work-tracks/WT-04-realtime-board-sync.md) (decisions 4, 8, 9 and 11);
  [WS-037](WS-037-board-page.md) (the board), [WS-038](WS-038-task-detail.md) (its window
  events), [WS-047](WS-047-events-endpoint.md) (the endpoint)

## Approach

### 1. Where things stand (checked on 2026-11-18)

- `GET /api/v1/projects/{projectId}/events` (`projectId` is the id or the key) answers
  only after it has subscribed to the hub, so every event committed after the browser
  sees the response reaches it. It sends `retry: 3000`, then `: connected`, heartbeats,
  and one frame `event: <type>` + `data: <JSON>` per event. It ends the stream when the
  client lags 64 KiB behind, the hub resets, or a heartbeat finds the session invalid. It
  answers `401`, `403`, `404` or `429 too_many_streams` before streaming.
- The board (`src/components/board/use-board.ts`) loads columns and every task once, adds
  tasks its viewer creates, moves cards optimistically, reloads after a failed move, and
  follows the task detail's window events (`changed`, `deleted`).
- `TaskSummary` has `version` and `columnId` but no `position`: the list endpoint returns
  tasks in board order, and `?columnId=` lists one column in order.
- A card shows key, title, type, assignee and team; not the epic, not comments.
- `project-frame.tsx` holds the project (with `version` and `archivedAt`); the board is
  read-only when `archivedAt` is set.

### 2. The shared hook: `useProjectEvents`

`src/hooks/use-project-events.ts`:

```ts
useProjectEvents(projectRef: string, {
  onEvent: (event: ProjectEvent) => void,
  onOpen: (first: boolean) => void,   // first: the stream's first open since mount
}): { status: "connecting" | "live" | "paused" }
```

- Opens `new EventSource("/api/v1/projects/<ref>/events")` (same origin; the session
  cookie goes with it; `connect-src 'self'` allows it). Listens to the nine types of
  `PROJECT_EVENT_TYPES`; each `data` is parsed with `projectEventSchema` and dropped if it
  does not parse or its `projectId` is not the project's.
- `open` → `status: "live"` and `onOpen(first)`. Every open after the first is a
  reconnect, after which the caller reloads (doc 0002 section 4).
- The browser reconnects by itself after a stream that ended (`retry: 3000`). When the
  reconnect is refused (`401`, `404`, `429`…), `EventSource` stops for good
  (`readyState === CLOSED`): the hook then sets `status: "paused"`, closes it and opens a
  new one after a backoff of 5, 10, 20, 40, then 60 seconds, reset by the next `open`.
- Closes the source on unmount and when `projectRef` changes.
- `EventSource` is passed in through an optional factory parameter, so the hook is
  unit-tested with a fake (jsdom has none). No library is added.

### 3. Loading after the stream opens

The board's first load starts when the stream's first `open` arrives, not on mount, so no
change committed between the load and the subscription is missed. If the stream has not
opened after 3 seconds (for example a refused stream), the board loads anyway and stays
correct for its viewer's own changes, as today; when the stream opens later, that open
counts as a reconnect and the board reloads.

### 4. Applying events to the board

All of it in `useBoard`, with the pure parts in `src/components/board/live.ts`.

| Event                             | Board does                                                                                                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `task.created`, `task.restored`   | if the board does not hold the task with this version or newer: fetch the task (`GET /api/v1/tasks/{id}`), then reload its column (`?columnId=`) to get the order |
| `task.updated`                    | if the held version is older (or the task is absent): fetch the task; same column → replace the card in place; other column (or absent) → as a move               |
| `task.moved`                      | if the held version is older: fetch the task, remove it from the column it was in, reload its new column                                                          |
| `task.deleted`                    | remove the card (the payload is enough)                                                                                                                           |
| `column.changed`                  | reload the whole board (columns and tasks): column changes are rare, and a reorder or delete changes the layout                                                   |
| `project.changed`                 | if the event's version is newer than the held project's: fetch the project and give it to the project frame, which makes the board read-only or writable          |
| `comment.created`, `epic.changed` | nothing: a card shows neither (WI-049 handles them where they are shown)                                                                                          |

The version rule (WT-04 decision 4): an event whose `version` is not newer than the one
the board holds for that entity is the echo of a write already shown, and is ignored. A
fetched task that comes back deleted or `404` is removed. Fetches for the same task do
not run twice at once; a newer event for a task whose fetch is in flight refetches once
it ends.

"Reload a column" uses the list endpoint with `columnId` and every page, as the board's
first load does, and replaces that column only. No API change: `position` stays private.

### 5. Events during a drag or a move

While a card is being dragged, or a move is being saved, incoming events are queued, not
applied: applying them would change `board` under the drag's `preview` and could move a
card the user holds. When the drag ends (dropped or cancelled) and the move's answer has
been applied, the queue is applied in order. The queue holds at most 200 events; past
that, it is dropped and the board reloads once (a long drag in a busy project).

### 6. What is said, and what is shown

- Other people's changes are not announced to screen readers: on a busy board they would
  drown the announcements of the viewer's own moves. The one exception: when an event
  makes the project archived (or unarchived), the board's live region says "This project
  was archived. The board is read-only." (or "…unarchived…").
- While `status` is `"paused"`, a status line above the board says "Live updates are
  paused. Reconnecting…" (`role="status"`). It is not shown during the browser's own
  3-second retries, only once the hook has given up on a source.
- The task detail's window events (WS-038) stay, as WT-04 decision 9 says; their comment
  in `src/components/task/events.ts` says they are no longer temporary. The event that
  follows a save carries the same version and is ignored.

### 7. End-to-end tests and parallel runs

Every test creates its own project, so the parallel workers never see each other's events
(WT-04 risk 6). The second browser is a second context of the same test, signed in as
another seeded account.

### Considered and not chosen

- **Load on mount, then reload at the first open**: two full loads of every board.
- **Add `position` to `TaskSummary`** so a card can be placed without reloading its
  column: an API change for a client detail; the column reload is one or a few requests.
- **Reload the whole board on every event**: simple, but a busy 1 000-task board would
  reload many times a minute.
- **Announce every remote change**: see section 6.

## Files

| Path                                                         | Change                                                                                    |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `src/hooks/use-project-events.ts` (+ `.test.tsx`)            | create: section 2                                                                         |
| `src/components/board/live.ts` (+ `.test.ts`)                | create: version rule, placing and removing cards                                          |
| `src/components/board/use-board.ts` (+ `use-board.test.tsx`) | modify: sections 3 to 5                                                                   |
| `src/components/board/api.ts`                                | modify: `listColumnTasks`; the task is read with `getTask` of the task detail (id or key) |
| `src/components/board/board.tsx` (+ `board.test.tsx`)        | modify: hold during drags, status line, archive notice                                    |
| `src/components/task/events.ts`                              | modify: the comment (section 6)                                                           |
| `tests/e2e/live-board.spec.ts`                               | create: section 7, test plan                                                              |
| `docs/README.md`, WT-04, WI-048, WS-048                      | modify: statuses                                                                          |

## Data model changes

None.

## API contract

None. The board uses existing endpoints: the events stream, `GET /api/v1/tasks/{id}`,
`GET /api/v1/projects/{ref}/tasks?columnId=`, the columns list and `GET` project.

## Test plan (written first, in this order)

| #   | Level | Test                                                                                                                                                                                                                            | Covers criterion |
| --- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit  | `live.ts`: the version rule (older, equal, newer, absent); removing a card; replacing a card in place; replacing one column                                                                                                     | 4, 7             |
| 2   | unit  | `useProjectEvents` with a fake `EventSource`: parses and delivers events, drops malformed ones and other projects'; `onOpen(true)` then `onOpen(false)`; `CLOSED` → `paused`, a new source after the backoff; closes on unmount | 9                |
| 3   | unit  | `useBoard` with a fake stream and mocked fetches: first load waits for the first open (or 3 s); each event row of section 4; an echo does no fetch; a reconnect reloads                                                         | 1–7, 9           |
| 4   | unit  | `useBoard`: events during a drag and during a move are applied after; more than 200 queued → one reload                                                                                                                         | 8                |
| 5   | unit  | `Board`: the archive notice in the live region; the paused status line                                                                                                                                                          | 6, 9             |
| 6   | e2e   | two contexts: a card moved by mouse in A is moved in B without a reload                                                                                                                                                         | 1                |
| 7   | e2e   | a task created through the API (`page.request`) appears in B's column                                                                                                                                                           | 2                |
| 8   | e2e   | a task deleted in A (task detail) disappears from B; restored from the project settings, it reappears                                                                                                                           | 3                |
| 9   | e2e   | a title edited in A's task detail shows on B's card                                                                                                                                                                             | 4                |
| 10  | e2e   | a column added in A's project settings appears on B's board                                                                                                                                                                     | 5                |
| 11  | e2e   | a Manager archives the project in A: B's board becomes read-only and says so; unarchived, it is writable                                                                                                                        | 6                |
| 12  | gate  | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; `pnpm openapi:generate` changes nothing                                                                                                                                | 10               |

The stream's own reconnection after a hub reset or a revoked session is tested on the
server by WI-046 and WI-047; here it is covered by test 2 and 3 with the fake source.

## Risks and open questions

For the owner:

1. **First load waits for the stream** (section 3), with a 3-second fallback. The board
   shows its skeleton a few milliseconds longer. **Recommend: as proposed.**
2. **Reload the affected column** to place a moved or created card (section 4), rather
   than adding `position` to the API. **Recommend: as proposed.**
3. **Hold events during a drag or a move** (section 5). **Recommend: as proposed.**
4. **Announce only archive and unarchive** to screen readers, not every remote change
   (section 6). **Recommend: as proposed.**
5. **A "paused" status line** only once the browser has given up reconnecting
   (section 6). **Recommend: as proposed.**
6. **Hook in `src/hooks/`**, shared with WI-049. **Recommend: as proposed.**

## Deviations from the approved spec

1. **A test helper, `src/hooks/fake-event-source.ts`**, holds the fake `EventSource` shared
   by the hook's, the board hook's and the board's tests. It can open each new source by
   itself (`autoOpen`), so the existing board tests run unchanged apart from installing it.
2. **`useBoard` takes `projectId`, `onProjectChanged` and `fallbackMs`.** The page owns the
   project, so the board hook reports a `project.changed` version and `Board` reads the
   project and announces an archive or an unarchive. `fallbackMs` lets the unit test use a
   short fallback.
3. **A failure other than `404` while refreshing a card reloads the whole board.** The spec
   did not say; this keeps the rule that the board never shows what the server does not
   hold.
4. **An existing end-to-end test changed, not weakened.** "A card someone else moved is
   refreshed, with an explanation" needs a board that missed the other move. A live board
   now receives it, so the test blocks that page's events stream (`page.route`) to keep
   testing the `409` path.
5. **A latent race in `tests/e2e/people.spec.ts` was fixed.** Its `showEveryone` helper
   clicked "Load more" while the button was disabled; when that load was the last, the
   button disappeared and the click waited until the test timed out. The six new tests
   add twelve accounts to each run, which put the people list past one page of 50 and made
   it fail in 2 of 3 full runs. The helper now waits for each load to end. Not a change to
   what the test checks.

## Implementation record

- Red, run before any code changed:
  - unit: `live.test.ts`, `use-project-events.test.tsx`, the new `useBoard` tests (no
    stream was ever opened) and the 3 new `Board` tests failed;
  - end-to-end: with the implementation stashed, the 6 tests of `live-board.spec.ts`
    failed waiting for the board's events request, which was never made.
- Green:
  - `src/hooks/use-project-events.ts`;
  - `src/components/board/live.ts`;
  - `useBoard`: first load on the stream's first open, or after 3 seconds; each event of
    section 4; a queue while dragging or moving, reloading past 200;
  - `listColumnTasks` in `src/components/board/api.ts`;
  - `Board`: `hold` around drags, the archive and unarchive notice, and the "paused"
    status line;
  - the comment of `src/components/task/events.ts`.
- Unit: 11 + 7 + 16 + 4 new tests.
- End-to-end: `live-board.spec.ts`, 6 tests, passed 5 runs out of 5 (`--repeat-each=5`,
  `--retries=0`).
- `pnpm openapi:generate`: no change.
- Gate on 2026-11-18:
  - typecheck, lint and Prettier pass;
  - Vitest 1219 of 1219;
  - `pnpm test:e2e` 74 of 74 with `--retries=0`, three full runs in a row after the
    people helper fix;
  - Windows, Node 24, pnpm 10.28.0, Compose PostgreSQL on port 5433.
