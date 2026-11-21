# WS-101 — The backlog in the data model and API

- Status: Approved (approved by the owner on 2026-11-21, questions 1 to 3 as recommended)
- Work-item: [WI-101](../work-items/WI-101-backlog-api.md)
- Canonical docs: [0003](../canonical/0003-task-management.md) sections 3, 4, 5;
  [0002](../canonical/0002-realtime-sync.md) section 4;
  [0004](../canonical/0004-api-conventions.md) sections 5, 8;
  [0001](../canonical/0001-ai-qa-agents-and-triage.md) section 6;
  [WT-07](../work-tracks/WT-07-backlog-priority-due-dates-labels.md) decisions 1 to 5,
  questions 1, 2, 8

## Approach

### 1. What changes, checked against `main` (`edf82ca`)

A backlog task is a task with `column_id is null` (WT-07 decision 1). Today every query
assumes a column, in five places that matter:

| Where                               | Today                                                       | After                                                            |
| ----------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------- |
| `TASK_SELECT` (`services/tasks.ts`) | `join columns c`: a task with no column is never found      | `left join columns c`; `column_position` nullable                |
| `listTasks`                         | every live task, ordered and paged by column position       | only tasks with a column; `deleted=true` also lists backlog ones |
| `createTask`                        | first column or `columnId`, locked; end of that column      | also `columnId: null`: end of the backlog                        |
| `moveTask`                          | `columnId` a uuid, column locked, neighbours in that column | also `null`: neighbours among the project's backlog tasks        |
| `bug-reports.ts`, open lookup       | `join columns ... category <> 'done'`                       | `left join columns ... category is distinct from 'done'`         |

Unchanged, each with a test: `placeNewBug` (agent-filed bugs still go to the top of the
first column, WT-07 out of scope), the closed lookup (only `done` columns), epic progress
(its total does not join columns, its done count does), column deletion (it moves deleted
tasks of that column only), comments, deletion and restore (they keep `column_id` and
`position` as they are).

### 2. Positions and locks

The backlog uses the same `position` column and the same fractional keys
(`src/lib/position.ts`). Its order is guarded by a new partial unique index
`tasks_backlog_position_idx` on `(project_id, position) where column_id is null`; the
existing `(column_id, position)` index never sees backlog tasks, since nulls are distinct.
Deleted tasks keep their place, so neighbours are read over deleted tasks too, as in a
column.

Writes into a column lock the column row (`for no key update`, WS-031 section 3). A
backlog has no row of its own, so writes into it lock the **project row** instead:

- `createTask` already takes it, by `claimTaskNumber`'s `update` (WS-030).
- `moveTask` with `columnId: null` calls `lockWritableProject(..., "exclusive")` instead of
  the shared lock; a move to a column keeps the shared project lock and the column lock.
  Moving a task out of the backlog creates no backlog position and needs no backlog lock.

Every other task write takes the project row `for share`, so a move into the backlog
waits for them and they wait for it, for the length of one short transaction (question
1).

### 3. Creating

`createTaskRequestSchema.columnId` becomes `z.uuid().nullable().optional()`. Absent: the
first column, as today (WT-07 question 1). `null`: after the last backlog task of the
project, deleted or not. The `created` history entry records `columnId: null`.

### 4. Moving

`moveTaskRequestSchema.columnId` becomes `z.uuid().nullable()`, still required. With
`null`:

- the "others" are `project_id = <the task's project> and column_id is null and id <> <task>`;
- `afterTaskId` / `beforeTaskId` must be a live backlog task of that project, else `400`
  naming the field ("Not another task of the backlog.");
- without either, the task goes to the end of the backlog;
- a move within the backlog to its current gap keeps its key, as within a column.

The `moved` history entry is written when the column changes, `null` included
(`{ columnId: null }` to `{ columnId: "<uuid>" }` and back); a reorder within the
backlog writes none, like a reorder within a column. `version` grows and `task.moved` is
sent on every move, as today.

### 5. Reading

- **`GET /api/v1/projects/{projectId}/backlog`**, `tasks:read`, query `limit` and
  `cursor`. Items: the live tasks with no column, ordered by `position, id`, as
  `TaskSummary`. The cursor is a new `BacklogCursor { position, id }` in
  `src/server/http/pagination.ts`, built like `BoardCursor`. `404` for an unknown project,
  `403` for a project outside an agent's restriction (`findProjectRef`).
- **`GET /projects/{projectId}/tasks`** adds `t.column_id is not null` when listing live
  tasks, so the board and `opanel_get_board` load only the board (WT-07 decision 3). With
  `deleted=true` it lists every deleted task, ordering a backlog task by
  `coalesce(c.position, '~')`: `~` sorts after every base-62 key byte by byte, so backlog
  tasks come after the columns' tasks and the board cursor needs no new shape (question
  3). With `columnId`, unchanged.
- `TaskSummary.columnId` and `Task.columnId` become `z.uuid().nullable()`, described "The
  task's column; `null` when the task is in the backlog." (WT-07 question 8.)

### 6. The triage pipeline

The open lookup in `bug-reports.ts` becomes:

```sql
select t.id, t.number from tasks t left join columns c on c.id = t.column_id
where t.project_id = $1 and t.fingerprint = $2
  and t.deleted_at is null and c.category is distinct from 'done'
```

so a report counts on an open bug that someone moved to the backlog (WT-07 decision 4).

### 7. The web app, kept correct

The nullable `columnId` reaches the components' types, and a task can now leave the board
through the API (an agent, the MCP server). This item makes the app correct, not richer;
the Backlog page is item D (question 2):

- `use-board.ts`: a refreshed task whose `columnId` is `null` is removed from the board
  instead of being placed in a column; a `task.moved` to the backlog therefore drops the
  card on every open board.
- `details-section.tsx`: when `columnId` is `null` the column select shows "In backlog" as
  its placeholder; choosing a column moves the task to the end of it, as today.
- `new-task-dialog.tsx`, `moves.ts`, `live.ts`: type changes only.

## Files

| Path                                                                    | Change                                             |
| ----------------------------------------------------------------------- | -------------------------------------------------- |
| `src/server/db/schema/tasks.ts`                                         | modify: nullable `columnId`, the partial index     |
| `src/server/db/migrations/0019_backlog.sql` and `meta/`                 | create (`pnpm db:generate`)                        |
| `src/lib/schemas/tasks.ts`                                              | modify: `columnId` nullable; `listBacklogContract` |
| `src/lib/schemas/tasks.test.ts`                                         | modify                                             |
| `src/lib/openapi/contracts.ts`, `docs/api/openapi.json`                 | modify, regenerate                                 |
| `src/server/http/pagination.ts`, `pagination.test.ts`                   | modify: `BacklogCursor`                            |
| `src/server/services/tasks.ts`                                          | modify: sections 1 to 5                            |
| `src/server/services/tasks.integration.test.ts`                         | modify                                             |
| `src/server/services/task-move.integration.test.ts`                     | modify                                             |
| `src/server/services/task-delete.integration.test.ts`                   | modify                                             |
| `src/server/services/backlog.integration.test.ts`                       | create: the backlog list, concurrency              |
| `src/server/services/bug-reports.ts`, `bug-reports.integration.test.ts` | modify: section 6                                  |
| `src/server/services/epics.integration.test.ts`                         | modify: a backlog task in progress                 |
| `src/app/api/v1/projects/[projectId]/backlog/route.ts`                  | create                                             |
| `src/app/api/v1/projects/[projectId]/backlog/route.integration.test.ts` | create                                             |
| `src/app/api/v1/tasks/[taskId]/move/route.integration.test.ts`          | modify                                             |
| `src/app/api/v1/viewer-writes.integration.test.ts`                      | unchanged: no new write endpoint                   |
| `src/components/board/use-board.ts`, `use-board.test.tsx`               | modify: section 7                                  |
| `src/components/board/live.ts`, `moves.ts`, `new-task-dialog.tsx`       | modify: types                                      |
| `src/components/task/details-section.tsx`, `task-detail.test.tsx`       | modify: section 7                                  |
| `tests/e2e/live-board.spec.ts`                                          | modify: a move to the backlog through the API      |
| `docs/work-items/WI-101-backlog-api.md`, this file                      | status                                             |

## Data model changes

Migration `0019_backlog`, generated by `pnpm db:generate`:

- `alter table tasks alter column column_id drop not null;`
- `create unique index tasks_backlog_position_idx on tasks (project_id, position collate "C") where column_id is null;`
  (the column is already `collate "C"`; the generated SQL is kept as drizzle-kit writes it)

No data changes: every existing task keeps its column. The runtime role's grants are on the
table and need nothing new (doc 0006 section 5).

## API contract

| Operation                                  | Access        | Change                                                                 |
| ------------------------------------------ | ------------- | ---------------------------------------------------------------------- |
| `GET /api/v1/projects/{projectId}/backlog` | `tasks:read`  | **new**: `200 TaskPage`, `400` (query), `403`, `404`                   |
| `GET /api/v1/projects/{projectId}/tasks`   | `tasks:read`  | live list leaves out backlog tasks; `deleted=true` includes them, last |
| `POST /api/v1/projects/{projectId}/tasks`  | `tasks:write` | `columnId` may be `null`: end of the backlog                           |
| `POST /api/v1/tasks/{taskId}/move`         | `tasks:write` | `columnId` may be `null`; anchors must then be backlog tasks           |
| Every answer with `Task` or `TaskSummary`  | —             | `columnId: uuid \| null`                                               |

No new error code, permission or event type. Not breaking under doc 0004 section 8 except
the nullable `columnId`, which WT-07 question 8 accepted before the first tagged release.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                                           | Covers criterion |
| --- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit        | `taskSummarySchema` and `taskSchema` accept `columnId: null`; `createTaskRequestSchema` accepts `null` and absent; `moveTaskRequestSchema` accepts `null`, still requires it                   | 2, 3             |
| 2   | unit        | `BacklogCursor` round-trips; a board cursor, a bad id or an oversized position is `400` naming `cursor`                                                                                        | 4                |
| 3   | integration | the migration: two backlog tasks of one project with one position violate `tasks_backlog_position_idx`; the same position in two projects, or in a column, does not                            | 1                |
| 4   | integration | `createTask` with `columnId: null` puts tasks at the end of the backlog in order, with a `created` entry naming `columnId: null`; without `columnId`, the first column                         | 2                |
| 5   | integration | `moveTask` to the backlog: at the end, after and before a backlog task; within the backlog; back to a column; each `version` + 1, one `task.moved`; `moved` entries only on a change of column | 3                |
| 6   | integration | `moveTask` to the backlog with an anchor in a column, in another project's backlog or deleted is `400` naming the anchor field; a stale `version` is `409 version_conflict`                    | 3                |
| 7   | integration | twenty concurrent creations and moves into one backlog leave twenty distinct positions, in a stable order                                                                                      | 9                |
| 8   | integration | `GET /backlog` lists live backlog tasks only, in order, across pages of 2; a deleted backlog task is not listed; a restricted agent gets `403` for another project                             | 4                |
| 9   | integration | `listTasks` leaves backlog tasks out; with `deleted=true` it lists a deleted column task, then a deleted backlog task, across pages of 1; restoring puts it back in the backlog at its place   | 5                |
| 10  | integration | a backlog task: get by id and by key, `PATCH`, comment, delete; each answers `columnId: null`                                                                                                  | 6                |
| 11  | integration | a report matching an open bug moved to the backlog answers `deduplicated` and creates nothing; a bug in a `done` column still gets a regression link                                           | 7                |
| 12  | integration | an epic with one done task, one board task and one backlog task shows 1 of 3                                                                                                                   | 8                |
| 13  | integration | the routes: `GET /backlog` with a cookie and with an agent token (`tasks:read`); move to the backlog with an agent token (`tasks:write`); a Viewer's move is `403`                             | 3, 4             |
| 14  | unit        | `use-board`: a refreshed task with `columnId: null` leaves the board; `task-detail`: a backlog task shows "In backlog" and choosing a column calls the move                                    | 10               |
| 15  | e2e         | `live-board.spec.ts`: a task moved to the backlog through the API disappears from an open board                                                                                                | 10               |
| 16  | unit        | the OpenAPI document: the new path, nullable `columnId` in `Task`, `TaskSummary` and both requests; `docs/api/openapi.json` regenerated                                                        | 11               |
| 17  | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; `pnpm db:generate` and `pnpm openapi:generate` leave no diff                                                                          | 11               |

## Risks and open questions

Resolved by the owner on 2026-11-21, by approving each recommendation:

1. **Locking the backlog by the project row** (section 2), rather than an advisory lock
   keyed on the project's backlog, as WT-06 did for dedupe. The project row is what
   creations already lock, and moves into the backlog are rare next to moves on the board.
   **Recommend: the project row.**
2. **This item keeps the web app correct for backlog tasks** (section 7): the board drops
   them and the task detail says "In backlog", so `main` never shows a stale card while
   items A to D land. The alternative leaves all UI to item D and accepts that an API move
   leaves a card on open boards until a reload. **Recommend: include the minimal UI here.**
3. **Deleted backlog tasks last in the deleted list** (section 5), by a `~` sentinel that
   keeps the board cursor's shape, rather than a separate `GET /backlog?deleted=true`.
   The project settings' "Deleted tasks" list then shows and restores them with no
   change. **Recommend: as proposed.**

Risks:

- **WI-100 (the MCP read tools) parses answers with the shared schemas.** Whichever of the
  two merges second takes in `main` and reruns its tests (`AGENTS.md` section 8);
  `opanel_get_board` loads only the board from then on, which is what it is for.
- **A raw `sql` join on `columns` added elsewhere later would hide backlog tasks again**
  (follow-up D08). Test 10 reads a backlog task through every task operation, so a
  regression there fails.
