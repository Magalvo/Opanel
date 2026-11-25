# WS-130 — The list view of tasks, with sortable headers

- Status: Approved (approved by the owner on 2026-11-25, questions 1 to 3 as recommended)
- Work-item: [WI-130](../work-items/WI-130-task-list-view.md)
- Canonical docs: [0003](../canonical/0003-task-management.md) section 8 (the list view,
  "the current filter lives in the URL"); [0004](../canonical/0004-api-conventions.md)
  section 5 (`sort=field`, `sort=-field`, cursors);
  [WT-08](../work-tracks/WT-08-search-filters-list-timeline.md) decisions 1, 4, 8 and 9,
  questions 2 and 5; [WS-118](WS-118-task-list-across-projects.md) (the endpoint);
  [WS-120](WS-120-task-filter-bar.md) (the filter bar and the filter in the URL)

## Approach

### 1. Starting point, checked against `main` (`17d45ec`)

- `GET /api/v1/tasks` (WS-118) lists live tasks of every reachable project that is not
  archived, or of the named `projectId`s, with every filter but `columnId`, and `sort`
  (default `-updated`). Items are `TaskListItem`: `TaskSummary` with `project` and
  `column` (`null` in the backlog). A named project out of a restricted agent's reach is a
  `403`, an unknown one a `404`, a label or epic outside the scope a `400`.
- No UI calls it. `src/components/board/api.ts` has an unrelated `listAllTasks`, which
  reads every page of one project's board list.
- `src/components/filters/` (WS-120) has `readFilter`, `writeFilter`, `chipsOf`,
  `useUrlTaskFilter` and `TaskFilterBar`. `readFilter` checks each parameter with
  `taskListQuerySchema`'s shape, which has no `projectId`. The bar reads the project from
  `useProject()` (the project frame's context) for its label and epic menus, and always
  shows the status line "N of M tasks match."
- `usePagedList` (WS-080) keeps a "Load more" list with each id once and drops a page that
  arrives for an old list.
- The sidebar (`app-sidebar.tsx`) has Projects, Teams, People and Agents. The project
  frame's navigation (`project-frame.tsx`) has Board, Backlog, Epics and Settings.
- A task's page is `/projects/KEY/tasks/KEY-N`. The intercepted dialog
  (`@modal/(.)tasks`) only opens from inside the project's pages.
- `isOverdue` and `formatDueDate` (`task/due-date.ts`), `useToday`, and the card's
  `DueDateText` say a due date and whether it is overdue in text.

### 2. The filter and the order in the URL

In `src/components/filters/task-filter.ts`:

- `FILTER_KEYS` gains `projectId`, written first. `readFilter` checks each parameter with
  the shape of `allTasksQuerySchema` merged over `taskListQuerySchema`'s, so `projectId`
  (an id or a key) is read like the others.
- `BOARD_KEYS` and `BACKLOG_KEYS` leave `projectId` out; `LIST_KEYS` (new) is every key
  but `columnId`. A `projectId` in a board link is now named among the ignored
  parameters, as `columnId` already is on the backlog.
- `chipLabel` names a project chip "Project: KEY" (from `FilterNames.projects`, the key
  itself when the project is unknown).
- `readSort(params)` reads `sort` with `taskSortSchema`: absent is `-updated`, an
  unreadable one is `-updated` and named as ignored. `writeSort` leaves `-updated` out of
  the link, so the default view has a bare `/tasks`.

`useUrlTaskList()` (new, `src/components/task-list/use-url-task-list.ts`) is
`useUrlTaskFilter` with the order: it reads both once and writes both with
`router.replace` and `scroll: false` on every change, as WS-120 deviation 1 does. When
`projectId` changes, it also drops `labelId` and `epicId`: they belong to one project,
and the API answers `400` for one outside the scope.

### 3. The filter bar, without a project frame

`TaskFilterBar` takes the project from props instead of `useProject()`:

- `projectKey: string | null`. The board and the backlog pass their project's key. The
  list passes the key when `projectId` holds exactly one project, and `null` otherwise.
  With `null`, the Label and Epic menus hold one disabled item: "Choose one project to
  filter by label" (or "by epic"). Chips of labels or epics from a link still show and
  can be removed.
- `projects?: { value, label }[]`: when given, a "Project" menu comes first, writing
  `projectId` by key, so links read `projectId=OPA`.
- `status?: string`: the status line. The board and the backlog pass "N of M tasks
  match." as today; the list passes its own (section 4).

The Assignee menu lists Me, Unassigned and the people assigned to a loaded row, as on the
board (WS-120 question 2).

### 4. The page

`src/app/(app)/tasks/page.tsx`, a server component: `requireAccount()`, title "Tasks",
and `<TaskList />`. Every signed-in account may read it; the API applies `tasks:read`.

`TaskList` (`src/components/task-list/task-list.tsx`, a client component):

- reads the filter and the order with `useUrlTaskList`; reads the projects that are not
  archived (every page of `listProjects(false)`) once, for the Project menu and the chips;
- reads the first page of `GET /api/v1/tasks?limit=50&sort=…&…filter` into
  `usePagedList` when it opens and whenever the filter or the order changes, keeping only
  the latest answer (`invalidate`, then `show`); "Load more" reads the next page;
- "Refresh" reads the first page again (WT-08 question 5: not live);
- status line: "Showing 50 tasks; more to load." or "Showing 12 tasks." (`role="status"`);
  while loading, the previous rows stay, as on a filtered board (WS-120 deviation 2);
- empty: "No tasks match these filters." with "Clear filters", or "No tasks yet." with no
  filter; an error: an alert naming the API's message (a `400` names the field), with
  "Try again".

The table (`task-list-table.tsx`), a `<table>` with a caption "Tasks" (visually hidden):

| Column   | Content                                              | `sort`     |
| -------- | ---------------------------------------------------- | ---------- |
| Key      | a link to `/projects/KEY/tasks/KEY-N`                | `key`      |
| Title    | the title                                            | `title`    |
| Type     | `TYPE_LABELS`                                        | none       |
| Status   | the column's name, or "Backlog"                      | none       |
| Priority | `PRIORITY_LABELS`                                    | `priority` |
| Assignee | the person, else the team, else "Unassigned"         | none       |
| Due      | `formatDueDate`, with "Overdue" in text when overdue | `dueDate`  |
| Updated  | a relative time, the exact time in a `<time>` title  | `updated`  |

A sortable header holds a button "Sort by ‹name›"; the sorted one has `aria-sort`
`ascending` or `descending` and an arrow icon hidden from assistive technology. A click
on an unsorted header sorts ascending, except Updated, which starts descending (the
newest first, as the default); a click on the sorted header reverses it. `created` has no
column: it works from a link only, and no header is marked sorted then.

Overdue uses the row's `column.category === "done"` for "done", and a backlog task is
never done, as on the cards. On a narrow screen the table scrolls sideways inside its own
container, so the page never does.

A row's key is a link to the task's full page (the dialog only opens from inside a
project); the browser's back returns to `/tasks` with its query string, which the page
reads again.

### 5. Navigation

- `AppSidebar`: "Tasks" (`ListTodoIcon`) after "Projects", for everyone.
- `ProjectFrame`: "List" after "Backlog", a link to `/tasks?projectId=KEY`. It never shows
  as the current tab, since it leaves the project's pages.
- `src/components/task-list/api.ts`: `listTaskItems(query: string)` for
  `GET /api/v1/tasks`, named so it is not confused with the board's `listAllTasks`.

## Files

| Path                                                      | Change                                                   |
| --------------------------------------------------------- | -------------------------------------------------------- |
| `src/components/filters/task-filter.ts`, its test         | modify: `projectId`, `LIST_KEYS`, `readSort`/`writeSort` |
| `src/components/filters/task-filter-bar.tsx`, its test    | modify: `projectKey`, `projects`, `status` props         |
| `src/components/board/board.tsx`                          | modify: pass `projectKey` and `status`                   |
| `src/components/backlog/backlog.tsx`                      | modify: pass `projectKey` and `status`                   |
| `src/components/task-list/api.ts`                         | create: `listTaskItems`                                  |
| `src/components/task-list/use-url-task-list.ts`, its test | create: section 2                                        |
| `src/components/task-list/task-list.tsx`, its test        | create: section 4                                        |
| `src/components/task-list/task-list-table.tsx`, its test  | create: section 4, the table and its headers             |
| `src/app/(app)/tasks/page.tsx`                            | create: the route                                        |
| `src/components/app-shell/app-sidebar.tsx`                | modify: "Tasks"                                          |
| `src/components/app-shell/app-shell.test.tsx`             | modify: "Tasks" in the sidebar                           |
| `src/components/projects/project-frame.tsx`, its test     | modify: "List"                                           |
| `tests/e2e/task-list.spec.ts`                             | create: tests 9 to 11                                    |
| `tests/e2e/accessibility.spec.ts`                         | modify: the list, filtered and sorted, both themes       |

## Data model changes

None.

## API contract

None: the page uses `GET /api/v1/tasks` of WS-118.

## Test plan (written first, in this order)

| #   | Level | Test                                                                                                                                       | Covers criterion |
| --- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| 1   | unit  | `readFilter` with `LIST_KEYS` reads `projectId` by key and id, repeated; `columnId` is ignored; on the board `projectId` is ignored        | 5                |
| 2   | unit  | `readSort`/`writeSort`: every sort both ways round-trips; absent and unreadable are `-updated`, the unreadable one named; default left out | 4, 5             |
| 3   | unit  | `useUrlTaskList`: a filter or sort change writes one `router.replace`; a `projectId` change drops `labelId` and `epicId`                   | 3, 5             |
| 4   | unit  | the bar: with `projectKey` `null` the Label and Epic menus say to choose one project; with `projects` the Project menu writes keys         | 3                |
| 5   | unit  | the table: each column's content, "Backlog" for no column, the assignee fallbacks, "Overdue" in text, a done task never overdue            | 2                |
| 6   | unit  | the table: a header click writes `sort`, a second click reverses it, Updated starts descending, `aria-sort` on the sorted header only      | 4                |
| 7   | unit  | the list: one read per filter or sort change, only the latest applied; "Load more" shows each id once; "Refresh" reads the first page      | 2, 6             |
| 8   | unit  | the list: the empty states, "Clear filters", the error alert and "Try again"; the board and backlog bars still say "N of M"                | 8                |
| 9   | e2e   | a Member opens "Tasks" and sees tasks of two projects; "List" in a project shows only that project's; a key opens the task, back returns   | 1, 2, 7          |
| 10  | e2e   | a Member filters by project and label and sorts by priority; the URL holds all three; another Member opening it sees the same rows         | 3, 4, 5          |
| 11  | e2e   | a task changed through the API does not change the list until "Refresh"                                                                    | 6                |
| 12  | e2e   | the accessibility checks of the list, filtered and sorted, a menu open, in light and dark mode                                             | 9                |

## Risks and open questions

Questions for the owner, each with a recommendation:

1. **Label and epic filters across projects.** Labels and epics belong to one project;
   listing every project's in one menu would repeat names ("bug" in each project) and read
   every project's labels. **Recommend: the menus work when exactly one project is chosen,
   and say so otherwise (section 3);** a link may still carry them.
2. **Where a row opens its task.** The intercepted dialog lives inside a project's pages;
   moving it to `/tasks` means a second `@modal` slot under the app layout. **Recommend:
   the full task page, with the browser's back returning to the list;** a dialog can follow
   if the full page feels heavy.
3. **Which headers sort.** WT-08 decision 4 offers six sorts; `created` has no column in
   decision 9. **Recommend: the five shown columns sort from their header, and `created`
   works from a link only,** rather than adding a "Created" column or a sort menu.

Risks:

- **The four sorts no index serves miss 100 ms on large installs** (WS-118 measurements,
  accepted by the owner, the follow-up on slow task lists). The page shows the previous
  rows while it reads, so a slow sort does not blank it.
- **The filter bar changes its props**, which the board and the backlog use. Their WS-120
  tests run unchanged apart from the props and guard them.
- **A `projectId` in a board link becomes an ignored parameter** with the page's notice
  (section 2), where it was silently dropped before. No link the app writes carries one.
