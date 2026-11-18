# WS-049 — Live task detail, epics page and project settings

- Status: Done (approved by the owner on 2026-11-18, questions 1 to 6 as proposed)
- Work-item: [WI-049](../work-items/WI-049-live-detail-epics-settings.md)
- Canonical docs: [0002](../canonical/0002-realtime-sync.md) (sections 3 and 4);
  [WT-04](../work-tracks/WT-04-realtime-board-sync.md) (decisions 4, 9, 10 and 11);
  [WS-048](WS-048-live-board.md) (the hook, the board); [WS-036](WS-036-projects-pages.md)
  (the project frame and settings), [WS-038](WS-038-task-detail.md) (the task detail),
  [WS-039](WS-039-epics-page.md) (the epics page)

## Approach

### 1. Where things stand (checked on 2026-11-18)

- `ProjectFrame` (`src/components/projects/project-frame.tsx`) loads the project and wraps
  every project page: the board, the task page, the task dialog over the board (`@modal`),
  the epics page and the settings. It holds the project in a context (`useProject`).
- The board opens its own stream with `useProjectEvents` (WS-048), and handles
  `project.changed` by reading the project again and announcing an archive or unarchive.
- The task detail (`task-detail.tsx`) loads the task, columns, comments (oldest first,
  paged), teams and open epics. Its form (`details-section.tsx`) already merges a new
  version of the task: edited fields keep the draft, the others take the new value; a
  conflict restarts the form from the server's version.
- The epics page loads one page of epics with progress (`doneTasks`/`totalTasks`) and
  "Load more"; its edit dialog handles `409` (WS-039).
- The settings: the details form keeps its own `name`, `description`, `version`; the
  columns section and the deleted tasks section each load their list and handle `409`.

### 2. One stream per project page, owned by the frame

A provider in `ProjectFrame`, `ProjectEventsProvider` (`src/components/projects/project-events.tsx`),
calls `useProjectEvents(project.id, …)` once the project is loaded, and offers through
context:

```ts
useProjectEventListener({
  onEvent?: (event: ProjectEvent) => void,
  onReconnect?: () => void,
}): { status: LiveStatus }
```

- Every listener gets every event of the project; `onReconnect` runs on every open after
  the first.
- The provider handles `project.changed` itself: if the version is newer than the frame's
  project, it reads the project again and sets it in the frame. Every page then follows
  the archived state, as it already does after a reload.
- The board moves to this context: it no longer opens a stream of its own. Its first load
  (WS-048 section 3) starts at once when the stream is already live when the board mounts,
  otherwise at the first open or after the 3-second fallback. Its archive notice now comes
  from watching `project.archivedAt` change, not from the event.
- So the task dialog over the board shares the board's stream: one per page, as the cap of
  10 streams per account (WT-04 decision 7) assumes.

### 3. The task detail

| Event                                      | Task detail does                                                                                                                                                           |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `task.updated`, `task.moved` for this task | if newer than the version held: read the task; apply it by the rule below                                                                                                  |
| `task.deleted` for this task               | "This task was deleted." in the status line; the form and comments become read-only                                                                                        |
| `task.restored` for this task              | load the task again (it is no longer read-only)                                                                                                                            |
| `comment.created` for this task            | if the comment is not shown yet and every page of comments is loaded: read the comments again (every page) and show the new ones; else nothing (it comes with "Load more") |
| `column.changed`                           | read the columns again (the column select and its names)                                                                                                                   |
| `epic.changed`                             | read the open epics again (the epic select), when the viewer can edit                                                                                                      |
| reconnect                                  | load the task (by the rule below) and its comments again                                                                                                                   |

The rule for a newer version of the task (WT-04 decision 10):

- **No unsaved edits**: show it, as after one's own save, and say "Someone else changed
  this task." in the status line.
- **Unsaved edits** (the form's draft differs from the task): show the new version, so the
  fields the viewer is not editing update and the ones they are editing keep their text
  (the form's existing merge). But saves stay based on the version the viewer started
  from: the next save gets `409 version_conflict`, and the existing conflict flow shows
  the other person's version and asks them to make their change again. Meanwhile the
  status line says "Someone else changed this task. Saving will show their version
  first."

The form reports whether it has unsaved edits to the detail (`onDirtyChange`), and takes
the version to save with (`saveVersion`) next to the task.

### 4. The epics page

`epic.changed`, and every task event (a task's epic, move or deletion changes progress),
reload the epics list: the same filter, as many items as are shown (pages are read until
that count is reached or there is no more). Reloads are coalesced: at most one runs, and
events during it cause one more after it, at least 500 ms apart. An open edit dialog keeps
its form; a save on a stale version gets the `409` it already handles. A reconnect
reloads too.

### 5. The project settings

- **Details**: when the frame's project gets a newer version, the form takes the new name,
  description and version if it has no unsaved edits; with unsaved edits it keeps them and
  its version (the next save gets the `409` it already handles) and says "Someone else
  changed this project. Saving will show their version first."
- **Columns**: `column.changed` reloads the list. An open add or edit dialog is not
  touched.
- **Deleted tasks**: `task.deleted` and `task.restored` reload the list (its first page
  and as many more as are shown).
- A reconnect reloads all three.

### 6. What is announced

Only the status lines above, which already exist on each page: no live region per event.
The board keeps its rule (WS-048 section 6).

### Considered and not chosen

- **A stream per component** (WS-048's hook used directly by each): the task dialog over
  the board would open a second stream, and every live part of a page would count against
  the cap of 10.
- **Overwriting a form with unsaved edits**: discards what the viewer typed, which
  decision 10 forbids.
- **Taking the new version into a form with unsaved edits**: the next save would succeed
  and silently overwrite the other person's change to the same field.
- **Patching epic progress from task events**: the event says what changed, not the epic
  or the column category; a reload is simpler and stays correct.

## Files

| Path                                                                                                                              | Change                                                  |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `src/components/projects/project-events.tsx` (+ test)                                                                             | create: section 2                                       |
| `src/components/projects/project-frame.tsx` (+ test)                                                                              | modify: the provider; `project.changed`                 |
| `src/components/board/use-board.ts`, `board.tsx` (+ tests)                                                                        | modify: use the frame's stream; archive notice by state |
| `src/components/task/task-detail.tsx`, `details-section.tsx` (+ test)                                                             | modify: section 3                                       |
| `src/components/task/comments-section.tsx`                                                                                        | modify: new comments, deduplicated by id                |
| `src/components/epics/epics-page.tsx` (+ test)                                                                                    | modify: section 4                                       |
| `src/components/projects/details-section.tsx`, `columns-section.tsx`, `deleted-tasks-section.tsx` (+ `project-settings.test.tsx`) | modify: section 5                                       |
| `tests/e2e/live-pages.spec.ts`                                                                                                    | create: the end-to-end tests below                      |
| `docs/README.md`, WT-04, WI-049, WS-049                                                                                           | modify: statuses; WT-04 exit criteria                   |

## Data model changes

None.

## API contract

None.

## Test plan (written first, in this order)

| #   | Level | Test                                                                                                                                                                                         | Covers criterion |
| --- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit  | the provider: one source per project page however many listeners; every listener gets each event; `onReconnect` on a reopen; `project.changed` newer → project read and set, older → nothing | 7, 8             |
| 2   | unit  | the board on the frame's stream: loads at once when the stream is live, waits otherwise; the archive notice when `archivedAt` changes; WS-048's board tests still pass                       | 9                |
| 3   | unit  | task detail: an update with no unsaved edits replaces the task and says so; with unsaved edits keeps them, updates the others, saves with the old version and shows the conflict             | 2, 3             |
| 4   | unit  | task detail: deleted → read-only and says so; restored → loaded again; a new comment appended once (not twice for one's own); columns and epics read again on their events                   | 1, 4             |
| 5   | unit  | epics page: reloads on epic and task events, coalesced, keeping the shown count and filter                                                                                                   | 5                |
| 6   | unit  | settings: details form updated, or kept with its version and the notice; columns and deleted tasks reloaded on their events                                                                  | 6                |
| 7   | e2e   | two contexts: a comment and a title change made in A appear in B's open task detail                                                                                                          | 1, 2             |
| 8   | e2e   | B types in the title; A changes the description; B's description updates, its title text stays, the notice shows; B's save shows the conflict notice and A's version                         | 3                |
| 9   | e2e   | an epic created and then closed in A appears and changes status on B's epics page                                                                                                            | 5                |
| 10  | e2e   | a column renamed in A's settings shows in B's settings                                                                                                                                       | 6                |
| 11  | e2e   | the board with a task dialog open makes one request to the events endpoint                                                                                                                   | 7                |
| 12  | gate  | `typecheck`, `lint`, `format:check`, `test`, `test:e2e` (including `live-board.spec.ts`); `pnpm openapi:generate` changes nothing                                                            | 9                |

## Risks and open questions

For the owner:

1. **Move the stream to the project frame** (section 2), changing the board of WI-048 to
   use it. **Recommend: as proposed.**
2. **A form with unsaved edits** shows other fields' new values but saves on the old
   version, so the next save gets the `409` (section 3). This is decision 10 as written.
   **Recommend: as proposed.**
3. **"Someone else changed this task."** in the status line when the task changes and
   there is nothing unsaved (section 3). **Recommend: as proposed.**
4. **A task deleted while open stays open, read-only, with a notice** (section 3), rather
   than closing the dialog or leaving the page. **Recommend: as proposed.**
5. **The epics page reloads on every epic and task event**, coalesced, 500 ms apart at
   most (section 4). **Recommend: as proposed.**
6. **New comments appear only when every page is loaded** (section 3); otherwise they come
   with "Load more", as today. **Recommend: as proposed.**

## Deviations from the approved spec

1. **The fake `EventSource` is installed for every unit test** in `vitest.setup.ts`: every
   project page now opens a stream, and jsdom has none. Its sources stay closed unless a
   test opens them or sets `FakeSource.autoOpen`.
2. **The board's archive notice follows a `project.changed` event** it heard, then the
   frame's new project: a project the board itself read again after a refused move is
   not announced twice.
3. **The task detail tracks its own writes.** The end-to-end tests showed that the event
   of the viewer's own save can arrive, and its read answer, after the save's answer; the
   detail then took it for someone else's change. While a save, a move or a comment is
   running, a newer version is only noted; when the write ends it is read, if it is still
   newer than what the write returned. The latest version and edit state are kept in a
   ref, not read from a closure. A unit test reproduces the order.
4. **One's own new comment is never shown twice:** its event may bring it in before the
   answer of the request that added it.
5. **The People end-to-end helper changed again.** WS-048's version could click "Load
   more" twice before the button showed it was loading, so the same page was read twice
   and a row appeared twice; with this item's ten more accounts per run, a People test
   failed in one of three full runs. Each click now waits for the response of the page it
   asked for. Not a change to what the tests check.

## Implementation record

- Red, run before each part's code:
  - unit: the provider (module missing), the board on the frame's stream, 6 task detail
    tests, 6 epics page tests, 5 settings tests;
  - the own-save race, reproduced by a unit test after the end-to-end run found it;
  - end-to-end: with `src` stashed, 4 of the 5 tests of `live-pages.spec.ts` failed
    waiting for the page's events request. The fifth, one stream with the task dialog
    open, passed already, since the old dialog opened none; it guards the shared stream.
- Green:
  - `src/components/projects/project-events.tsx`, used by `ProjectFrame`;
  - the board moved to it;
  - the task detail, its form and its comments;
  - the epics page, with coalesced reloads;
  - the three settings sections.
- End-to-end: `live-pages.spec.ts`, 5 tests, and `live-board.spec.ts` passed 5 runs out
  of 5 (`--repeat-each=5`, `--retries=0`).
- `pnpm openapi:generate`: no change.
- Gate on 2026-11-18:
  - typecheck, lint and Prettier pass;
  - Vitest 1245 of 1245;
  - `pnpm test:e2e` 79 of 79, three full runs in a row with `--retries=0`;
  - Windows, Node 24, pnpm 10.28.0, Compose PostgreSQL on port 5433.
