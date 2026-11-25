# WS-123 — The live board keeps the newest state

- Status: Proposed
- Work-item: [WI-123](../work-items/WI-123-live-board-consistency.md)
- Canonical docs: [0002](../canonical/0002-realtime-sync.md) section 4 (after a reconnect,
  read again what you show); [WS-048](WS-048-live-board.md) sections 4 and 5 (applying
  changes, holding events during a drag); [WS-049](WS-049-live-detail-epics-settings.md)
  section 2 (the page's one stream, the frame's project);
  [WS-082](WS-082-board-reload-ordering.md) (ordered loads, generations; questions 3 and
  4); [WS-113](WS-113-board-live-reorder.md) (one fetch per task)

## Approach

### 1. Starting point, checked against `main` (`83c5272`)

- **The frame's project (C02, B15).** `ProjectFrame` (`project-frame.tsx`) holds the
  project in `useState` and hands `setProject` to every page. Four readers call it with a
  fresh `getProject`: the events provider after a newer `project.changed`
  (`project-events.tsx`), the board after a move refused as archived (`board.tsx`), and
  the Details and Triage settings after a save. None compares versions, so an older answer
  that arrives last wins. On a reconnect, `onOpen` tells the listeners but reads no project,
  so a rename or archive made while the stream was down is never seen.
- **Column reads (C03).** `useBoard`'s `placeTask` (`use-board.ts`) checks the triggering
  task's version, then awaits `listColumnTasks` and applies
  `replaceColumn(removeTask(...), columnId, tasks)`: the whole column, as it was when read.
  Fetches are coalesced per task (WS-113), not per column, so two tasks of one column can
  have reads in flight at once, and a read can return after a newer change to that column
  has been applied. Nothing drops it.
- **Results during a drag (WS-082 question 3).** A full load in flight when a drag starts
  is dropped (`supersede`), but a task fetch or a column read is applied when it returns,
  under the drag.
- **Loaders (C04).** `listAllTasks` and `listColumnTasks` (`board/api.ts`) append every
  page with `tasks.push(...page.items)`. A task moved forward in board order during the
  load can be listed twice, in two columns; `groupByColumn` keeps both. The held event
  usually repairs it after the load, but the loader itself does not hold one card per task.

### 2. The frame keeps the newest project (B15, C02)

- `ProjectFrame`'s `setProject` becomes version-aware: it applies a project only when none
  is held or its `version` is at least the held one (a functional state update, so two
  answers in one tick compare with each other). Equal versions apply, since a save's own
  answer may carry new fields at the same version. Every reader above goes through it, so
  none needs its own check. The first load and Retry set the project as today.
- `ProjectEventsProvider`'s `onOpen`, on every open after the first, reads the project
  again (`getProject`) and sets it, before telling the listeners. A failure is ignored: the
  next reconnect or `project.changed` reads it again.
- The board announces an archive only after a `project.changed` event (WS-048 section 6).
  A change found on reconnect is shown (the badge, the read-only board) without that
  announcement, as on a page load.

### 3. Column reads follow the newest change (C03)

`useBoard` gets one read per column at a time, and a rule for when its answer may be
applied:

- **An epoch per column.** `setBoard` compares each column's array with the one it
  replaces and adds one to that column's epoch when it changed. Every change goes through
  `setBoard`: events applied in place, removals, other columns' reads (`replaceColumn`
  takes their cards out of this column), the task detail's changes, local moves, full
  loads.
- **One read per column.** `readColumn(columnId, taskId)` replaces the direct
  `listColumnTasks` call in `placeTask`. A read asked for while one runs for that column
  marks it to run once more, as `refreshTask` does per task, and adds the task to the ids
  the read takes out of other columns.
- **Applied only if nothing overtook it.** A read notes the column's epoch and the load
  generation when it starts. When it returns:
  - during a drag or a move, the column is marked stale and nothing is applied;
  - if the epoch or the load generation changed meanwhile, it is read again;
  - otherwise it is applied as today, with `replaceColumn` and the triggering tasks
    removed from other columns.
- **After a drag or a move**, `flush` reads each stale column again (unless it reloads the
  whole board, which covers them).

Reading again is bounded by the changes that arrive: each extra read follows a change to
that column. Comparing only the triggering task's version, as today, is not enough, as the
audit showed.

### 4. Task fetches wait for a drag or a move (WS-082 question 3)

`refreshOnce` applies its result only when no drag or move is in progress. Otherwise the
task's id joins a stale set, and `flush` fetches each again once the drag or the move ends
(with `ordered` if any request for it was). With section 3 this answers the follow-up "A
card refresh already in flight when a drag starts can still change the board under the
drag".

### 5. One card per task when loading (C04)

A pure `uniqueTasks(tasks)` in `live.ts` keeps one item per task id: the one with the
highest `version`, the later one on a tie, at the position of the one kept. Both loaders in
`board/api.ts` return `uniqueTasks` of their pages. This makes each load hold one card per
task by itself; it does not make paging a snapshot, which the held events still repair as
today.

## Files

| Path                                              | Change                                        |
| ------------------------------------------------- | --------------------------------------------- |
| `src/components/projects/project-frame.tsx`       | modify: version-aware `setProject`            |
| `src/components/projects/project-events.tsx`      | modify: read the project again on reconnect   |
| `src/components/board/use-board.ts`               | modify: column epochs and reads; results held |
| `src/components/board/live.ts`                    | modify: `uniqueTasks`                         |
| `src/components/board/api.ts`                     | modify: both loaders return unique tasks      |
| `src/components/projects/project-frame.test.tsx`  | modify: test 1                                |
| `src/components/projects/project-events.test.tsx` | modify: test 2                                |
| `src/components/board/live.test.ts`               | modify: test 3                                |
| `src/components/board/use-board.test.tsx`         | modify: tests 4 to 9                          |
| WI-123, WS-123                                    | modify: statuses, implementation record       |

No dependency, no migration, no API change. `docs/README.md` changes only by index commits
on `main`: C02, C03, C04, B15's version check and the drag follow-up are marked answered by
WI-123 once it is done.

## Data model changes

None.

## API contract

None.

## Test plan (written first, in this order)

The hook tests use the existing fake API, `deferNext` and the fake event source of
`use-board.test.tsx`; the frame tests use the same fake API.

| #   | Level | Test                                                                                                                                                                                                                                                                   | Covers criterion |
| --- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit  | `project-frame.test.tsx`: a page calls `setProject` with version 3, then with version 2: the header keeps version 3's name; version 3 again applies. Fails today                                                                                                       | 2                |
| 2   | unit  | `project-events.test.tsx`: open, drop and reopen the stream with no event, the server now answering version 2 renamed and archived: the provider sets version 2. A delayed `project.changed` read answering version 1 cannot undo it. Fails today                      | 1, 2             |
| 3   | unit  | `live.test.ts`: `uniqueTasks` keeps the newest version of a repeated task, the later on a tie, at the kept item's place, and leaves a list without repeats as it is                                                                                                    | 6                |
| 4   | unit  | `use-board.test.tsx`: A and B in "To do". A's move within the column starts a deferred column read; B's newer update is applied in place; the old read, holding B's old version, is released: B never shows its old version, and the column is read again. Fails today | 3                |
| 5   | unit  | same, with B deleted, and with B moved to "In progress" (its column read applied first), before the old read returns: B is not brought back to "To do". Fails today                                                                                                    | 3                |
| 6   | unit  | same, with a drag starting before the old read returns: nothing changes under the drag, and the column is read once the move ends. Fails today                                                                                                                         | 4                |
| 7   | unit  | a task fetch in flight when a drag starts: its answer changes nothing under the drag, and the task is fetched again once the drag ends (WS-082 question 3). Fails today                                                                                                | 5                |
| 8   | unit  | the first load lists A on page 1 in "To do" at version 1 and on page 2 in "Done" at version 2: one card, in "Done", at version 2; with equal versions, the later one. Fails today                                                                                      | 6                |
| 9   | unit  | a column read whose pages list a task twice shows one card. Fails today                                                                                                                                                                                                | 6                |

The existing tests of `useBoard`, the frame, the provider and `board.test.tsx` stay as they
are. As in WS-082, no E2E test is added: the ordering lives in the hook, which the unit
tests drive through the real fetch path with delayed answers.

## Risks and open questions

For the owner:

1. **Including the drag follow-up (section 4, criterion 5).** It is WS-082 question 3,
   left as a lower follow-up then; it shares this item's rule (nothing applied under a drag,
   read again after). **Recommend: include.**
2. **The "paused" status line of B15** is a separate UI change (WS-048 section 5's
   wording, `use-project-events.ts`). **Recommend: leave it as a follow-up.**
3. **No announcement for an archive found on reconnect** (section 2): the board is
   read-only at once, without the live-region message an event gives. **Recommend: as
   proposed**; announcing it would need the board to tell a reconnect's project apart from
   a save's.

Risk: section 3 adds state to an already busy hook. The epoch is kept in `setBoard`, the
one place every change passes through, so no caller has to remember it; tests 4 to 7 pin
the ordering.

## Deviations from the approved spec

None yet.

## Implementation record

Not started.
