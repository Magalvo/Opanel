# WS-030 — Tasks core

- Status: Approved (approved by the owner on 2026-11-13, questions 1 to 5 as proposed)
- Work-item: [WI-030](../work-items/WI-030-tasks-core.md)
- Canonical docs: [0003](../canonical/0003-task-management.md) sections 2, 3, 4, 9;
  [0002](../canonical/0002-realtime-sync.md) section 4;
  [0004](../canonical/0004-api-conventions.md) sections 3, 5, 6;
  [WT-03](../work-tracks/WT-03-board-core.md) decisions 3, 7, 8, 9, 10, 11, 13, 16

## Approach

### 1. What this item covers, and what it leaves

In: the `tasks` and `task_events` tables; create, read (by id or key), list (board order),
edit (title, description, type) and assign (team, person). Out, each in its own item:
moving between and within columns (WI-031), soft delete and restore (WI-032; the two
columns it needs are created now), a task's epic (WI-033), comments (WI-034). Fields of
later tracks (priority, due date, labels, severity, sprint, parent) are added by those
tracks.

### 2. Data model

```
tasks        id uuid pk,
             project_id uuid not null → projects (restrict),
             number int not null,                       unique (project_id, number)
             type text not null default 'task'          check in ('task', 'bug', 'story')
             title text not null,
             description text not null default '',
             column_id uuid not null → columns (restrict),     -- column_not_empty
             position text collate "C" not null,              -- amendment A2
             assignee_team_id uuid → teams (restrict),        -- team_in_use
             assignee_account_id uuid → accounts (restrict),
             reporter_account_id uuid not null → accounts (restrict),
             version int not null default 1  check >= 1,
             deleted_at timestamptz, deleted_by uuid → accounts (restrict),  -- used by WI-032
             created_at, updated_at
             unique index tasks_column_position_idx on (column_id, position)
             index tasks_assignee_team_idx on (assignee_team_id)
             index tasks_assignee_account_idx on (assignee_account_id)

task_events  id bigint generated always as identity pk,
             task_id uuid not null → tasks (restrict),
             actor_account_id uuid → accounts (restrict),    -- null: no authenticated actor
             type text not null  check in ('created', 'field_changed', 'moved',
                                           'deleted', 'restored', 'commented'),
             field text, old_value jsonb, new_value jsonb,
             created_at timestamptz not null default now()
             index task_events_task_idx on (task_id, created_at, id)
```

- **The key is not stored.** A task stores its `number`; its key is the project's key, a
  dash and the number (`OPA-12`). Project keys never change (decision 2), so the key never
  changes either, and it is never reused because numbers only grow (decision 3).
- **`task_events` is append-only** by the same trigger mechanism as `audit_log`
  (migration 0003): a hand-written migration adds a `BEFORE UPDATE OR DELETE` trigger that
  raises an error. All six event types are allowed now so later items add rows, not a
  migration; this item writes `created` and `field_changed`.
- `deleted_at` and `deleted_by` are created now, unused until WI-032, as WS-028 did for
  `next_task_number`. Every read in this item already ignores deleted tasks.

Migrations: `0008_tasks` (generated) and `0009_task_events_append_only` (custom,
`pnpm drizzle-kit generate --custom`).

### 3. Creating a task: number, place and locks

One transaction:

1. **Number and lock.** `update projects set next_task_number = next_task_number + 1 where
<id or key> and archived_at is null returning id, key, next_task_number - 1 as number`.
   No row: `404` if the project does not exist, otherwise `409 project_archived`. This
   update takes the project's row lock, so creations in one project run one at a time
   (decision 3) and every later statement of the transaction sees the tasks committed
   before it. It replaces `lockWritableProject` for creation: taking `for share` first and
   then updating the same row would let two creations deadlock.
2. **Column.** `columnId` if given (it must be a column of this project, else `400` with
   the field error `columnId`), otherwise the project's first column.
3. **Position.** After the column's last task: `positionBetween(last ?? null, null)`.
   Because creations are serialised, two creations never compute the same position.
4. **Insert** with `reporter_account_id` = the actor, then the `created` event, with
   `new_value` `{ "key", "type", "title", "columnId" }`.

Edits (section 5) take `lockWritableProject` in its default shared mode, as WS-028 intended.

### 4. Reading

| Operation                                | Access       | Success |
| ---------------------------------------- | ------------ | ------- |
| `GET /api/v1/tasks/{taskId}`             | `tasks:read` | `200`   |
| `GET /api/v1/projects/{projectId}/tasks` | `tasks:read` | `200`   |

- **`taskId` is the id or the key** (doc 0004 section 3): `z.union([z.uuid(), taskKeySchema])`
  where a key is `^[A-Z][A-Z0-9]{1,9}-[1-9][0-9]{0,8}$`. A deleted task is `404`.
- **The list** is in board order (decision 11): by the column's position, then the task's
  position, then id, all compared byte by byte. A new cursor kind in
  `src/server/http/pagination.ts` carries the three values (`encodeBoardCursor`,
  `decodeBoardCursor`). Optional filter `columnId` (a column of the project, else `400`).
  The default page size and maximum are those of doc 0004 (50, 100); the board loads every
  page.
- **List items omit the description.** A board shows titles; descriptions can be long
  (up to 50 000 characters). The list returns `TaskSummary`, `GET` returns `Task`.

```ts
teamRef = { id, name }; // "TeamRef"
person = { id, name, active }; // "Person" (WS-026)
taskSummary = {
  id,
  key,
  number,
  projectId,
  type,
  title,
  columnId,
  assigneeTeam: teamRef | null,
  assignee: person | null,
  reporter: { id, name },
  version,
  createdAt,
  updatedAt,
}; // "TaskSummary"
task = taskSummary & { description }; // "Task"
```

### 5. Creating and editing

| Operation                                 | Access        | Success | Specific errors                                                                             |
| ----------------------------------------- | ------------- | ------- | ------------------------------------------------------------------------------------------- |
| `POST /api/v1/projects/{projectId}/tasks` | `tasks:write` | `201`   | `400`, `404`, `409 project_archived`, `409 account_inactive`, `415`                         |
| `PATCH /api/v1/tasks/{taskId}`            | `tasks:write` | `200`   | `400`, `404`, `409 version_conflict`, `409 project_archived`, `409 account_inactive`, `415` |

```ts
createTask = { title, description?, type?, columnId?, assigneeTeamId?, assigneeAccountId? }   // strict
updateTask = { title?, description?, type?, assigneeTeamId?: uuid | null,
               assigneeAccountId?: uuid | null, version }      // strict, at least one field besides version
```

- **Title**: trimmed, 1 to 200 characters. **Description**: Markdown, up to 50 000
  characters, kept as written. **Type**: `task` (default), `bug` or `story`.
- **Assignment** (decision 8): `null` clears (doc 0004 section 6). A team must exist (else
  `400` on `assigneeTeamId`). A person must be a person in the sense of WS-026 (else `400`
  on `assigneeAccountId`) and active (else `409 account_inactive`). The person need not be
  a member of the team. A `PATCH` that does not send `assigneeAccountId` keeps a
  deactivated assignee.
- **Version**: WS-027 pattern, `update tasks ... where id = $id and version = $expected and
deleted_at is null`. No row: `404` if gone or deleted, otherwise `version_conflict` with
  the task as `current`. A `PATCH` that changes nothing bumps `version` and records no
  event, as for projects and columns.
- **History** (decision 13): one `field_changed` event per field whose value changed, with
  `field` (`title`, `description`, `type`, `assigneeTeamId`, `assigneeAccountId`),
  `old_value` and `new_value` as JSON (ids for assignees; the timeline of WT-08 resolves
  names). Full description text is kept on both sides. Events are written by
  `src/server/services/task-events.ts` (`recordTaskEvent`), in the same transaction, and
  record the acting account (hard rule 8). Task changes write no audit-log entry
  (decision 16).
- **Who may edit**: any actor with `tasks:write`, on any task (doc 0003: Members do full
  ticket work). Only deletion distinguishes own tasks (WI-032).

### 6. `team_in_use` and `column_not_empty`

The foreign keys from `tasks` use `restrict`, so deleting a referenced team or column fails
with PostgreSQL error `23503`. `deleteTeam` (WS-026) maps it to `409 team_in_use`, and
`deleteColumn` (WS-029) to `409 column_not_empty`. The check stays in the database, so it
holds under concurrency without extra locks. In this item every task counts, as there is
no deletion yet; WI-032 decides how soft-deleted tasks count (question 4).

New problem codes: `team_in_use`, `column_not_empty` (both `409`).

### 7. Concurrency, summed up

| Write                  | Lock                                                                |
| ---------------------- | ------------------------------------------------------------------- |
| create task            | `update projects` (row lock): creations in a project run one by one |
| edit task              | project `for share`, then the task row by its `update`              |
| column writes (WI-029) | project `for no key update`                                         |
| archive (WS-028)       | project `for update`                                                |

A column write and a task creation therefore never run at the same time in one project,
which also makes "delete the last column while a task is created in it" impossible.

## Files

| Path                                                                                   | Change                                    |
| -------------------------------------------------------------------------------------- | ----------------------------------------- |
| `src/server/db/schema/tasks.ts`, `task-events.ts`, `index.ts`                          | create, create, modify                    |
| `src/server/db/migrations/0008_tasks.sql`, `0009_task_events_append_only.sql` (+ meta) | create                                    |
| `src/lib/schemas/tasks.ts` (+ `.test.ts`)                                              | create: schemas and contracts             |
| `src/lib/schemas/problem.ts` (+ test)                                                  | modify: two codes                         |
| `src/lib/openapi/contracts.ts`                                                         | modify: four contracts                    |
| `src/server/http/errors.ts`, `pagination.ts` (+ tests)                                 | modify: two constructors, board cursor    |
| `src/server/services/tasks.ts`, `task-events.ts` (+ integration tests)                 | create                                    |
| `src/server/services/teams.ts`, `columns.ts` (+ tests)                                 | modify: `team_in_use`, `column_not_empty` |
| `src/server/db/schema/task-events.integration.test.ts`                                 | create: append-only                       |
| `src/app/api/v1/projects/[projectId]/tasks/route.ts`                                   | create                                    |
| `src/app/api/v1/tasks/[taskId]/route.ts`                                               | create                                    |
| route integration tests next to the routes                                             | create                                    |
| `docs/api/openapi.json`                                                                | regenerate                                |
| `docs/README.md`, WI-030, WS-030, WT-03                                                | modify: statuses                          |

No new dependency.

## Data model changes

Section 2: migrations `0008_tasks` and `0009_task_events_append_only`.

## API contract

Sections 4 and 5. All additive. The OpenAPI document gains four operations, the schemas
`TaskType`, `TeamRef`, `TaskSummary`, `TaskPage`, `Task`, `CreateTaskRequest`,
`UpdateTaskRequest` and `TaskVersionConflict`, and two problem codes.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                                                            | Covers criterion       |
| --- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 1   | unit        | schemas: title trimmed 1..200, description up to 50 000, type enum, ids UUID, `null` only on the update's assignee fields, update needs version and a field, unknown fields refused                             | validation             |
| 2   | unit        | task reference: a UUID or a key (`OPA-1`, `A1-123`); refuses `opa-1`, `OPA-0`, `OPA-01`, `OPA`, `OPA-`                                                                                                          | id or key              |
| 3   | unit        | board cursor round-trips and refuses other cursors; contracts declare `tasks:read` / `tasks:write`; `PATCH` documents `TaskVersionConflict`                                                                     | list, access           |
| 4   | integration | `task_events`: update and delete of a row are refused by the database                                                                                                                                           | append-only            |
| 5   | integration | `createTask`: key `OPA-1`, then `OPA-2`; in the first column by default, at the end; in a given column; reporter is the actor; `created` event                                                                  | keys, place            |
| 6   | integration | twenty concurrent creations in one project: keys `OPA-1` to `OPA-20` with no gap or duplicate, distinct positions                                                                                               | concurrency            |
| 7   | integration | a column of another project is `400` on `columnId`; an archived project is `project_archived`; an unknown one `404`                                                                                             | create errors          |
| 8   | integration | `getTask` by id and by key; unknown and wrong-project key are `404`                                                                                                                                             | read                   |
| 9   | integration | `listTasks`: board order across three columns after column reorder; `columnId` filter; pages of 2 join up; no description in items                                                                              | list                   |
| 10  | integration | `updateTask`: each field changed records one `field_changed` with old and new value; unchanged fields none; stale version is `version_conflict` with `current`                                                  | edit, history          |
| 11  | integration | assignment: team and person set and cleared; unknown team and non-person `400`; deactivated person `409 account_inactive`; a later-deactivated assignee shows `active: false` and survives an edit of the title | assignment             |
| 12  | integration | an event write that fails rolls back the task change (trigger on `task_events` for one event type)                                                                                                              | together               |
| 13  | integration | `deleteTeam` of an assigned team is `team_in_use`; `deleteColumn` of a column with a task is `column_not_empty`; both still work when unreferenced                                                              | rules                  |
| 14  | integration | routes: statuses and bodies; Viewer `403` on create and edit, Member `201`/`200`; `401` without a session                                                                                                       | endpoints, permissions |

## Risks and open questions

1. **List items omit the description** (section 4). Proposed to keep board pages small.
2. **Creation takes the project's row lock** rather than a separate counter table.
   Creations in one project wait for each other for a few milliseconds; edits and reads
   are not affected. Agents filing many bugs at once (WT-06) are the case to watch.
3. **Description history keeps both full texts.** Simple and complete; it can grow for
   descriptions edited often. Proposed as is for v1.
4. **Soft-deleted tasks and the team and column rules.** Decided in WI-032. Proposed there:
   a soft-deleted task does not keep a column from being deleted (it is moved to the
   project's first column when its column goes), and does keep its team assignment.
5. **No endpoint reads the history yet.** Events are written now; reading them is the
   activity timeline of WT-08.
