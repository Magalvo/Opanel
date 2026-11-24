# WS-120 — The filter bar on the board and the backlog

- Status: Done (approved by the owner on 2026-11-24, questions 1 and 2 as recommended; done on
  2026-11-24)
- Work-item: [WI-120](../work-items/WI-120-task-filter-bar.md)
- Canonical docs: [0003](../canonical/0003-task-management.md) section 8 ("filters apply
  to the board"; "the current filter lives in the URL");
  [0002](../canonical/0002-realtime-sync.md) section 4 (the events a filtered page
  follows); [WT-08](../work-tracks/WT-08-search-filters-list-timeline.md) decisions 1, 7
  and 8, question 4; [WS-116](WS-116-task-filters-search.md) (the filter parameters)

## Approach

### 1. Starting point, checked against `main` (`2a061d7`)

- `useBoard` (`src/components/board/use-board.ts`) loads the columns and every board task
  (`listAllTasks`, every page of `GET /projects/{projectId}/tasks`), keeps them by column,
  and follows the project stream: it refreshes one task or one column on `task.*` events,
  holds events during a drag or a move, and reloads after a reconnect (WS-048, WS-082,
  WS-113). `useBacklog` does the same for the backlog (WS-109).
- A move sends one anchor: the task above the card's new place (`afterTaskId`), or the one
  below it (`beforeTaskId`), or none (`moveRequest` in `board/moves.ts`, which the backlog
  reuses). The server puts the card right after or before that anchor, so a move works
  whatever lies hidden between the visible cards.
- Opening a card navigates to `/projects/KEY/tasks/KEY-N` in an intercepted dialog;
  closing it goes back in history.
- The UI has `DropdownMenu`, `Checkbox`, `Input`, `Badge` and `Button` from shadcn/ui.
- `useSearchParams` and `useRouter` (`next/navigation`) read and replace the query string
  in client components (installed docs: `use-search-params.md`, `use-router.md`).

### 2. The filter in the URL

A new module, `src/components/filters/task-filter.ts`:

- `readFilter(params: URLSearchParams)`: reads every filter parameter of WS-116
  (`taskListQuerySchema` without the page fields), one parameter at a time, so an
  unreadable one is dropped and named in `ignored` while the others still apply.
- `writeFilter(filter)`: the query string, with the API's names and repeated parameters,
  in a fixed order, so the same filter always gives the same link.
- `filterQuery(filter)`: the same string for an API call.
- `isEmpty(filter)`, `describe(filter)` (the chips: one per value, each with its label and
  the filter without it).

Changing a filter calls `router.replace` with the new query string and `scroll: false`, so
the history does not fill with every keystroke. `me` stays `me` (WT-08 decision 8).

### 3. The filter bar

`TaskFilterBar` (`src/components/filters/task-filter-bar.tsx`), a `search` landmark named
"Filter tasks":

- A search box, "Search tasks", writing `q` 300 ms after typing stops.
- One `DropdownMenu` per field, with checkbox items:

  | Menu     | Items                                                                |
  | -------- | -------------------------------------------------------------------- |
  | Type     | Task, Bug, Story                                                     |
  | Priority | None to Urgent                                                       |
  | Severity | Low to Critical                                                      |
  | Label    | the project's labels                                                 |
  | Epic     | No epic, and the project's open epics                                |
  | Team     | No team, and every team                                              |
  | Assignee | Me, Unassigned, and each person assigned to a task on the page       |
  | Reporter | Me, People, Agents                                                   |
  | Due      | Overdue (`dueTo` yesterday and `done=false`), Due in the next 7 days |

  "Overdue" and the 7 days are computed in the viewer's browser (WT-07 decision 7).

- The chips of the active filters, each a button "Remove ‹chip›", then "Clear filters".
- A status line: "12 of 140 tasks match." (`role="status"`).

Parameters without a control (a custom `dueFrom`/`dueTo`, `category`, `columnId`,
`reporterAccountId` other than `me`) come only from a link; they show as chips and can be
removed (question 1). Filters dropped by `readFilter` are named once in an alert: "Some
filters in this link were not understood and are ignored."

### 4. The board and the backlog

`useTaskFilter({ projectKey, place })` (`src/components/filters/use-task-filter.ts`):

- reads the filter from the URL;
- with a filter, reads every page of the filtered list (`GET /projects/{projectId}/tasks`
  or `/backlog` with `filterQuery`) and keeps the set of matching ids; without one, the set
  is "all";
- asks again after a `task.*` or `label.changed` event, or after the filter changes, at
  most once a second (WT-08 question 4), and after a reconnect;
- keeps only the latest answer, as the board's loads do (WS-082).

`Board` and `Backlog` show `useBoard`'s and `useBacklog`'s tasks that are in the set, in
their order; both hooks are unchanged and keep every task. A drop computes its place from
the board as shown, so its anchor is a shown card (section 1). The card menu's moves
(WS-111) work on the shown board the same way. Every column stays on a filtered board, and
an empty one says "No matching tasks". "Add task" stays; a new task that does not match
appears once the next answer says so.

Opening a card pushes the task's URL, and closing the dialog goes back in history
(section 1), to the filtered page with its query string; no link changes.

### 5. Data for the menus

The bar reads the project's labels (`listLabels`), open epics (`listOpenEpics`) and teams
(`listAllTeams`) once when it opens, and follows `label.changed` and `epic.changed` as the
task detail does; teams send no event, so their list is read again only with the page.
People come from the tasks on the page.

## Files

| Path                                                   | Change                                          |
| ------------------------------------------------------ | ----------------------------------------------- |
| `src/components/filters/task-filter.ts`, its test      | create: section 2                               |
| `src/components/filters/task-filter-bar.tsx`, its test | create: section 3                               |
| `src/components/filters/use-task-filter.ts`, its test  | create: section 4                               |
| `src/components/board/board.tsx`, its test             | modify: the bar, the shown board, drops         |
| `src/components/board/board-column.tsx`                | modify: "No matching tasks"                     |
| `src/components/backlog/backlog.tsx`, its test         | modify: the bar, the shown backlog, drops       |
| `tests/e2e/filters.spec.ts`                            | create: tests 8 to 10                           |
| `tests/e2e/accessibility.spec.ts`                      | modify: filtered board and backlog, both themes |

## Data model changes

None.

## API contract

None: the page uses the filters of WI-116.

## Test plan (written first, in this order)

| #   | Level | Test                                                                                                                       | Covers criterion |
| --- | ----- | -------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit  | `readFilter` and `writeFilter` round-trip every parameter, repeated ones too, in a fixed order; an unreadable one is named | 3                |
| 2   | unit  | the chips of every parameter, the ones without a control too, and each chip's filter without it                            | 1, 3             |
| 3   | unit  | the bar: typing writes `q` once after 300 ms; each menu writes its parameter; Overdue writes `dueTo` and `done=false`      | 1                |
| 4   | unit  | the bar: removing a chip and "Clear filters" write the URL; the status counts                                              | 1, 2             |
| 5   | unit  | `useTaskFilter`: one filtered read per change, at most one per second over a burst of events, only the latest applied      | 4                |
| 6   | unit  | the board shows only matching cards, every column, "No matching tasks"; a drop on it sends a shown anchor                  | 2, 5             |
| 7   | unit  | the backlog shows only matching rows; a keyboard move on it sends a shown anchor                                           | 2, 5             |
| 8   | e2e   | a Member filters the board by a label and a word; the URL holds both; another Member opening it sees the same cards        | 1, 2, 3          |
| 9   | e2e   | on a filtered board, a task changed through the API to match appears, and one changed to stop matching leaves, no reload   | 4                |
| 10  | e2e   | on a filtered backlog, opening and closing a task keeps the filter                                                         | 6                |
| 11  | e2e   | the accessibility checks of the filtered board and backlog, menus open, in light and dark mode                             | 7                |

## Risks and open questions

Questions for the owner, each with a recommendation:

1. **Which filters get a control.** Every doc 0003 filter works from the URL; the bar
   gives controls to the common ones (section 3). A custom due range, column categories
   and a named reporter would need a date range picker and a people search inside the bar.
   **Recommend: the controls of section 3, with the rest from a link and shown as chips;**
   the list view (item E) can add more controls later.
2. **Assignee choices.** Listing every person needs a search; the people already on the
   page cover the usual case. **Recommend: Me, Unassigned and the people on the page.**

Risks:

- **A filtered page reads the filtered list after every burst of events**: at most one
  request a second per open filtered page (WT-08 risk 3).
- **The board shows a subset of what it holds.** Drops use the shown board; a test per
  page checks that the anchor is a shown card.
- **Large boards** read every matching page, as the board reads every task today (the
  follow-up on slow task lists).

## Implementation record

- Red (20c4fc7): the three filter modules did not exist; the board and backlog tests found
  every card where the filter keeps one.
- Green (4e5b9d3): `task-filter.ts`, `task-filter-bar.tsx`, `use-task-filter.ts`,
  `use-url-task-filter.ts` in `src/components/filters/`; `board.tsx`,
  `board-column.tsx` and `backlog.tsx` show the matching tasks and translate a move.
- Fixes found by the end-to-end run (4d231a0): the menus are not modal, since Radix hid the
  page while a menu was open and axe flagged `aria-hidden-focus`; two selectors became
  exact.
- Gate on 2026-11-24: typecheck, lint and Prettier pass (after 669e484, formatting
  only); `pnpm db:generate` and `pnpm openapi:generate` leave no diff; Vitest 2341 of
  2341 (225 files); `pnpm test:e2e` 123 of 123; Windows 11, pnpm 10.28.0, Compose
  PostgreSQL on port 5433.

## Deviations

1. **The filter is read from the URL once and kept in the page's state** (section 2): each
   change writes the URL with `router.replace`, so there is no history to follow back and
   forth, and a test needs no router that re-renders.
2. **While a new filter is read, the page keeps the last answer** (section 4), so it does
   not flash every task between two filters; before any answer it shows none.
3. **A move's place is translated by `fullIndex`** (section 4): the drop's index on the
   shown board becomes the index on the full board right after the shown task above, or
   right before the one below. The keyboard drag of the backlog is checked through
   `fullIndex`'s unit tests and the board's menu move, since dnd-kit measures nothing
   in jsdom.
4. **The menus are not modal** (section 3), as above.
5. **The bar reads labels, epics and teams when their menu first opens**, not when the
   page opens, so a page that is never filtered makes no extra request.
