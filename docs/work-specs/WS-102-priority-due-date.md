# WS-102 — Priority and due date on tasks

- Status: Approved (approved by the owner on 2026-11-21, questions 1 to 3 as recommended)
- Work-item: [WI-102](../work-items/WI-102-priority-due-date.md)
- Canonical docs: [0003](../canonical/0003-task-management.md) sections 3, 4, 9;
  [0004](../canonical/0004-api-conventions.md) sections 3, 6, 8;
  [0002](../canonical/0002-realtime-sync.md) section 4;
  [WT-07](../work-tracks/WT-07-backlog-priority-due-dates-labels.md) decisions 6 and 7,
  question 4

## Approach

### 1. Order of work

WT-07 runs items A, B and C one after another: they touch the same schema, service and
migration journal. This work-spec is written now; its code starts once WI-101 (PR #99) is
on `main`, from a branch that takes in `main` (`AGENTS.md` section 8). The migration is
then `0020_priority_due_date`.

### 2. The fields

| Field      | Column                                                                             | API                                               |
| ---------- | ---------------------------------------------------------------------------------- | ------------------------------------------------- |
| `priority` | `text not null default 'none'`, check `in ('none','low','medium','high','urgent')` | `Priority` enum, same values (doc 0003 section 4) |
| `dueDate`  | `date` (drizzle `mode: "string"`), nullable                                        | `YYYY-MM-DD` or `null` (doc 0004 section 3)       |

`TASK_SELECT` reads `t.priority` and `to_char(t.due_date, 'YYYY-MM-DD') as due_date`, as
epics read their dates (WS-033). No index: filtering and sorting by them are WT-08.

### 3. Calendar dates

Zod 4's `z.iso.date()` (installed `zod@4.6.7`) checks the format and the calendar: it
refuses `2026-02-30` and `2027-02-29` and accepts `2028-02-29`. It also accepts
`0000-01-01`, which PostgreSQL refuses ("date/time field value out of range"), so the
write would fail inside the service. A shared `calendarDateSchema` in
`src/lib/schemas/dates.ts` adds a refinement: the year is `0001` or later ("Not a
calendar date."). Due dates use it. Epics have the same gap today (question 1).

### 4. Requests

```ts
createTask += { priority?: Priority, dueDate?: CalendarDate }
updateTask += { priority?: Priority, dueDate?: CalendarDate | null }  // null clears it
```

Each is a valid change on its own in `PATCH` (the "send at least one field" refinement
lists them). Permission `tasks:write`, as doc 0003 section 3 ("set priority, due date,
points"): Members, Managers, Admins and agents holding `tasks:write` (WT-07 question 4).

### 5. The service

- `createTask` writes both, defaulting priority to `none` and the date to `null`; the
  `created` history entry names them only when sent, as it does severity (WS-088).
- `updateTask` adds `["priority", "priority"]` and `["dueDate", "due_date"]` to `EDITABLE`,
  after `severity`, so each change is one `field_changed` entry with old and new values
  (`"none"`, `"2026-12-01"`, `null`); one `PATCH` is one `version` and one `task.updated`,
  as today.
- The triage pipeline's insert does not name `priority`: the column default gives `none`
  (doc 0003 section 4: an agent-filed bug arrives with priority `none`). A repeat changes
  only `occurrences` and `last_reported_at`, as WT-06 decision 10 says, so a priority a
  person set stays.

### 6. The web app

The two required fields reach `TaskSummary`, so the fixtures that build one
(`board/test-data.ts`, `board/moves.test.ts`, `project-settings.test.tsx`,
`task-detail.test.tsx`, `account-ref.test.ts`, `document.test.ts`) gain
`priority: "none", dueDate: null`. Nothing is shown yet (item E).

## Files

| Path                                                           | Change                                          |
| -------------------------------------------------------------- | ----------------------------------------------- |
| `src/lib/schemas/dates.ts`, `dates.test.ts`                    | create: `calendarDateSchema`                    |
| `src/lib/schemas/tasks.ts`, `tasks.test.ts`                    | modify: `prioritySchema`, fields, requests      |
| `src/server/db/schema/tasks.ts`                                | modify: two columns, the check                  |
| `src/server/db/migrations/0020_priority_due_date.sql`, `meta/` | create (`pnpm db:generate`)                     |
| `src/server/services/tasks.ts`                                 | modify: select, create, `EDITABLE`              |
| `src/server/services/task-priority.integration.test.ts`        | create                                          |
| `src/server/services/bug-reports.integration.test.ts`          | modify: priority `none`, kept on a repeat       |
| `src/app/api/v1/tasks/[taskId]/route.integration.test.ts`      | modify: `PATCH` by a Member, an agent, a Viewer |
| `docs/api/openapi.json`                                        | regenerate                                      |
| The fixtures of section 6                                      | modify                                          |
| `docs/work-items/WI-102-priority-due-date.md`, this file       | status                                          |

## Data model changes

Migration `0020_priority_due_date` (`pnpm db:generate`):

- `alter table tasks add column priority text default 'none' not null;`
- `alter table tasks add column due_date date;`
- `alter table tasks add constraint tasks_priority_check check (priority in ('none', 'low', 'medium', 'high', 'urgent'));`

Existing rows take the default; no backfill.

## API contract

| Operation                                 | Change                                                           |
| ----------------------------------------- | ---------------------------------------------------------------- |
| Every answer with `Task` or `TaskSummary` | `priority: Priority`, `dueDate: string \| null` (`format: date`) |
| `POST /api/v1/projects/{projectId}/tasks` | optional `priority`, `dueDate`                                   |
| `PATCH /api/v1/tasks/{taskId}`            | optional `priority`, `dueDate` (nullable)                        |

New response fields and optional request fields are not breaking (doc 0004 section 8). No
new permission, error code or event type.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                   | Covers criterion |
| --- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit        | `calendarDateSchema`: accepts `2028-02-29`, `0001-01-01`, `9999-12-31`; refuses `2026-02-30`, `2027-02-29`, `0000-01-01`, `2026-1-01`, `2026-12-31T00:00`              | 4                |
| 2   | unit        | `taskSchema` and `taskSummarySchema` require `priority` and `dueDate`; `priority` refuses `critical`; `dueDate` takes `null`                                           | 2                |
| 3   | unit        | requests: create with `priority` and `dueDate`; `PATCH` with `{ priority, version }` alone, `{ dueDate: null, version }` alone; a bad date is refused naming `dueDate` | 3, 4             |
| 4   | integration | the migration: an existing task (inserted before by SQL) answers `none` and `null`; `priority = 'critical'` violates `tasks_priority_check`                            | 1                |
| 5   | integration | `createTask` with `high` and `2026-12-01` answers them, and its `created` entry names them; without them, `none` and `null`                                            | 2, 3             |
| 6   | integration | `updateTask` sets, changes and clears each; each change is one `field_changed` entry with the actor and old and new values; one version per `PATCH`                    | 3, 5             |
| 7   | integration | both fields come back from get, the board list, the backlog, move, restore and a `409`'s `current`                                                                     | 2                |
| 8   | integration | a past due date (`2020-01-01`) is accepted                                                                                                                             | 4                |
| 9   | integration | a bug the pipeline creates has `none`; after a person sets `urgent`, a repeated report keeps `urgent`                                                                  | 6                |
| 10  | integration | the route: `PATCH` with `priority` by a Member's cookie and by an agent token with `tasks:write`; a Viewer gets `403`; `dueDate: "0000-01-01"` is `400`                | 4, 7             |
| 11  | unit        | the OpenAPI document: `Priority`, both fields in `Task`, `TaskSummary` and both requests; `docs/api/openapi.json` regenerated                                          | 8                |
| 12  | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; `pnpm db:generate` and `pnpm openapi:generate` leave no diff                                                  | 8                |

## Risks and open questions

Resolved by the owner on 2026-11-21, by approving each recommendation:

1. **Epics accept the year `0000` and fail inside the service** (section 3): an epic sent
   with `startDate: "0000-01-01"` passes Zod and is refused by PostgreSQL, so the client
   gets a `500` instead of a `400`. Fixing it is one line in `epics.ts` with the shared
   schema, but it is outside this item (hard rule 10). **Recommend: a follow-up on `main`
   (`docs: follow-up from WI-102`) and its own small work-item; this item creates the
   shared schema it will use.**
2. **`dueDate` on create takes a date or nothing, not `null`.** `null` would mean the same
   as leaving it out; doc 0004 section 6 uses `null` to clear on `PATCH`. **Recommend: as
   proposed.**
3. **Due dates have no upper bound beyond the year 9999.** A date far in the future is a
   person's choice, and the UI (item E) uses a date input. **Recommend: no bound.**

Risks:

- **WI-100 (PR #98, the MCP read tools) parses tasks with the shared schemas.** Two new
  required fields in `TaskSummary` change what its fixtures must contain; whichever merges
  second takes in `main` and reruns its tests.
- **Item C (labels) also edits `tasks.ts` and adds a migration.** It starts after this item
  merges, as WT-07 plans.
