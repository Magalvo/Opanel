# WS-118 — The list of tasks across projects, with sort

- Status: Done (approved by the owner on 2026-11-24, questions 1 and 2 as recommended; done on
  2026-11-24)
- Work-item: [WI-118](../work-items/WI-118-task-list-across-projects.md)
- Canonical docs: [0003](../canonical/0003-task-management.md) section 8;
  [0004](../canonical/0004-api-conventions.md) section 5 (cursors, `sort=field` and
  `sort=-field`); [0001](../canonical/0001-ai-qa-agents-and-triage.md) section 3 (project
  restrictions); [WT-08](../work-tracks/WT-08-search-filters-list-timeline.md) decisions
  1, 4, 5 and 6, questions 2 and 3; [WS-116](WS-116-task-filters-search.md) (the filter
  schema and builder)

## Approach

### 1. Starting point, checked against `main` (`21e45fa`)

- `taskFilterShape` and `taskFilterWhere` (WI-116) filter one project's tasks:
  `taskFilterWhere` checks that columns, labels and epics belong to `context.projectId`.
- `listProjects` limits a list to what an agent may reach with the private
  `reachableBy(actor)` (`and p.id in (...)`, or `and false` for an empty list), and is the
  one function in the coverage test's `PROJECT_FILTERED` list.
- Every project route answers `403` for a project outside a restricted agent's reach
  (`requireProjectAccess`, WS-073), and `404` for an unknown one.
- There is no `src/app/api/v1/tasks/route.ts`.
- `tasks` has no index on `updated_at` or `created_at`.

### 2. The query

In `src/lib/schemas/tasks.ts`:

- `TASK_SORTS`: `key`, `title`, `priority`, `dueDate`, `created`, `updated`;
  `taskSortSchema`: one of them, or one of them after `-`.
- `allTasksQuerySchema`: the page, `taskFilterShape`, `projectId` (`oneOrMany` of
  `projectRefSchema`) and `sort` (default `-updated`), with the due-date refinement of
  WS-116.
- `taskListItemSchema` (id `TaskListItem`): `taskSummarySchema` extended with
  `project: { id, key, name }` and `column: { id, name, category } | null`;
  `taskListItemPageSchema` its page.

### 3. The scope: which projects

`listAllTasks(actor, query)` in `src/server/services/tasks.ts`:

1. `requirePermission(actor, "tasks:read")`.
2. With `projectId`: each value is resolved with `findProjectRef` (an unknown one is a
   `404`, an unreachable one a `403`, as on every project route), and the scope is those
   projects, archived or not.
3. Without it: every project the actor may reach that is not archived. The restriction is
   `reachableBy(actor)`, which `projects.ts` exports for this, in the query itself.

**This corrects WT-08 decision 5**, which says a named project out of reach answers `404`
"as every project route does": every project route answers `403` (WS-073), so this
endpoint does too (question 1).

### 4. Filters across projects

`taskFilterWhere`'s context becomes `{ actor, projectIds: string[] | null }`: a list of
projects, or `null` for "every project the actor may reach". Its ownership check then
asks that each label and epic belongs to one of those projects (or, for `null`, to a
project the actor may reach), and answers `400` on the field otherwise. `listTasks` and
`listBacklog` pass their one project, so nothing changes for them. `columnId` is not in
this query.

### 5. Sort and cursor

| `sort`     | Order by (ascending; `-` reverses each key but the id)                       |
| ---------- | ---------------------------------------------------------------------------- |
| `key`      | `p.key collate "C"`, `t.number`                                              |
| `title`    | `lower(t.title) collate "C"`                                                 |
| `priority` | the priority's rank, `none` 0 to `urgent` 4                                  |
| `dueDate`  | `t.due_date is null` (always ascending, so no date comes last), `t.due_date` |
| `created`  | `t.created_at`                                                               |
| `updated`  | `t.updated_at`                                                               |

Each order ends with `t.id`, always ascending, so ties are broken the same way in both
directions. The cursor, a new `encodeTaskListCursor` in `src/server/http/pagination.ts`,
holds the sort, the last row's sort values as text (timestamps with microseconds, doc 0004
section 5) and its id. The next page compares the same expressions as a row value with
`>` or `<` per key, written out as `or`-ed conditions because the id never reverses. A
cursor whose sort is not the query's is a `400` on `cursor`.

### 6. The answer

`TASK_SELECT` gains `p.name as project_name`, `c.name as column_name` and
`c.category as column_category`; `toListItem` adds `project` and `column` to the
summary. `listTasks` and `listBacklog` keep answering `TaskSummary`.

### 7. Index and measurement

`tasks_updated_idx` on `(updated_at, id)`, which serves the default order (WT-08 decision
6). `scripts/measure-task-search.ts` gains a section for this list: the same 50 000 tasks
spread over 5 projects, each `sort` both ways, with no filter, with a common filter and
with `q`, first page and a page in the middle. The limit is that of WS-116 (100 ms for a
page); a miss is recorded and brought back to the owner, as it was there.

### 8. The route and the contract

`src/app/api/v1/tasks/route.ts` (`GET`): read the query, call `listAllTasks`, answer the
page. `listAllTasksContract`, `GET /api/v1/tasks`, `tasks:read`, `200`, `400`, `404`,
registered with the others.

## Files

| Path                                                     | Change                                                    |
| -------------------------------------------------------- | --------------------------------------------------------- |
| `src/lib/schemas/tasks.ts`                               | modify: sorts, the query, `TaskListItem`, the contract    |
| `src/lib/schemas/task-filter.test.ts`                    | modify: the query and `sort`                              |
| `src/lib/openapi/contracts.ts`                           | modify: register the contract                             |
| `src/server/http/pagination.ts`                          | modify: the task list cursor                              |
| `src/server/services/projects.ts`                        | modify: export `reachableBy`                              |
| `src/server/services/task-filter.ts`                     | modify: a list of projects in the context                 |
| `src/server/services/tasks.ts`                           | modify: `listAllTasks`, the select's names                |
| `src/server/services/all-tasks.integration.test.ts`      | create: scope, filters, sorts, pages                      |
| `src/server/services/project-access.integration.test.ts` | modify: `listAllTasks` as project-filtered, `reachableBy` |
| `src/app/api/v1/tasks/route.ts`, its integration test    | create                                                    |
| `src/server/db/schema/tasks.ts`, migration `0023`        | modify, create: `tasks_updated_idx`                       |
| `src/lib/openapi/document.test.ts`                       | modify: the operation and `TaskListItem`                  |
| `scripts/measure-task-search.ts`                         | modify: section 7                                         |

## Data model changes

Migration `0023_task_updated_index`: `tasks_updated_idx` on `tasks (updated_at, id)`.

## API contract

`GET /api/v1/tasks`, permission `tasks:read`.

- Query: `limit`, `cursor`, `sort`, `projectId` (repeatable), and the filters of WS-116
  except `columnId`.
- `200`: `{ items: TaskListItem[], nextCursor }`.
- `400`: an invalid value, a cursor of another sort, a label or epic outside the scope.
  `403`: a named project outside a restricted agent's reach. `404`: an unknown project.
- New endpoint: not breaking.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                     | Covers criterion |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| 1   | unit        | the query reads `sort` with and without `-`, defaults to `-updated`, refuses `sort=status` and `columnId`                | 3                |
| 2   | integration | without `projectId`: every reachable project's live tasks, board and backlog, no archived project, no deleted task       | 1                |
| 3   | integration | `projectId` by id and by key, repeated, an archived one named; unknown `404`; outside a restricted agent's reach `403`   | 2                |
| 4   | integration | each filter of WS-116 across two projects; a label of a project out of scope is a `400`                                  | 2                |
| 5   | integration | items carry `project` and `column`, `column: null` in the backlog                                                        | 1                |
| 6   | integration | each `sort` both ways over tasks with equal values, pages of 2 give every task once in order; no due date last both ways | 3, 4             |
| 7   | integration | a task updated between pages of `-updated` is not given twice on the pages after it                                      | 4                |
| 8   | integration | a cursor of another sort and a tampered cursor are a `400`                                                               | 3                |
| 9   | integration | a restricted agent's pages of 2 are full and hold only its projects                                                      | 5                |
| 10  | integration | the route: query strings reach the service; `400` names the field                                                        | 2, 3             |
| 11  | unit        | the OpenAPI document: the operation, `sort`, `projectId` as an array, `TaskListItem`                                     | 7                |
| 12  | manual      | the measurement, recorded                                                                                                | 6                |

## Risks and open questions

Questions for the owner, each with a recommendation:

1. **`403`, not `404`, for a named project out of reach.** WT-08 decision 5 says `404`
   "as every project route does", but every project route answers `403` (WS-073, the
   coverage test). **Recommend: `403`, like the others, and this spec records the
   correction of the decision** (hard rule 11: the doc and the code disagreed).
2. **Moving tasks while paging.** With `-updated`, a task changed between two pages moves
   to the front and is not on the later pages, as with any keyset list ordered by a value
   that changes. **Recommend: accept it, and say so in the contract's description**; the
   list view reloads when its filter or sort changes (WT-08 question 5).

Risks:

- **The cursor across six sorts** is the most complex part. Test 6 runs every sort both
  ways over equal values, the case that breaks a wrong comparison.
- **The ownership check across projects** changes `taskFilterWhere`, which WI-116's lists
  use; WI-116's tests run unchanged and guard them.
- **Raw SQL** (follow-up D08): the sort expressions are a fixed table in the service, never
  built from input.

## Implementation record

- Red (ff824b6): 25 of 188 tests failed, every one on the missing `allTasksQuerySchema`,
  `listAllTasks`, route and contract; the coverage test named `tasks.listAllTasks` and
  `projects.reachableBy` before they were exported.
- Green (4b1c572, ae21da4): the query, sorts and `TaskListItem` in
  `src/lib/schemas/tasks.ts`; `listAllTasks` with `taskSelect` naming the project and
  column; the task list cursor; `TaskListScope` in `task-filter.ts`; `reachableBy`
  exported; the route and contract; migration `0023_task_updated_index`.
- 9424427 (perf): the id follows the sort's direction (deviation 1).
- Gate on 2026-11-24:
  - typecheck, lint and Prettier pass; `pnpm db:generate` and `pnpm openapi:generate`
    leave no diff;
  - Vitest 2276 of 2276 (221 files);
  - `pnpm test:e2e` 115 of 115;
  - Windows 11, pnpm 10.28.0, Compose PostgreSQL on port 5433.

### Measurements (section 7), 2026-11-24

`scripts/measure-task-search.ts`, the data of WS-116 spread over 5 projects (about
10 000 tasks each). Median of 5 runs of the service call, a page of 50, in ms; "11th" is
the page after ten pages were read; a `q` list has fewer than 11 pages.

| Sort        | first | 11th | with `priority` first | with `q` first |
| ----------- | ----: | ---: | --------------------: | -------------: |
| `key`       |   184 |  185 |                    63 |             15 |
| `-key`      |   282 |  226 |                   100 |             19 |
| `title`     |   347 |  238 |                   131 |             18 |
| `-title`    |   252 |  305 |                   101 |             16 |
| `priority`  |   208 |  141 |                    65 |             21 |
| `-priority` |   198 |  128 |                    69 |             15 |
| `dueDate`   |   213 |  149 |                    67 |             12 |
| `-dueDate`  |   212 |  155 |                    67 |             13 |
| `created`   |   210 |  215 |                    66 |             12 |
| `-created`  |   212 |  217 |                    72 |             12 |
| `updated`   |    16 |   19 |                    18 |             60 |
| `-updated`  |    17 |   18 |                    17 |             55 |

- **The default order, `-updated`, is within the limit** (17 ms), served by
  `tasks_updated_idx`; so is every list with `q`.
- **The other five sorts with no filter, or with a filter that keeps a fifth of the tasks,
  miss the 100 ms limit** (up to 347 ms): no index serves them, so every matching task is
  sorted before the first page, as the board list does (the WI-116 follow-up). As section
  7 says, no index outside this spec was added; this goes back to the owner.
- Runs vary by up to half on this laptop (`title` measured 214 ms and 347 ms in two runs).

## Deviations

1. **The id follows the sort's direction** (section 5 said "always ascending"). With
   `updated_at desc, id asc` PostgreSQL cannot read `tasks_updated_idx` backwards, and
   the default order took 234 ms; with `id desc` it takes 17 ms. Ties are still broken one
   way, and test 6 checks every sort both ways.
2. **A cursor's values are checked against each key's shape** before they reach SQL, so a
   tampered value is a `400` and never a database error.
3. **The item's project and column have schema ids** `TaskProject` and `TaskColumn`.
