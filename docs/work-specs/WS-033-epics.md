# WS-033 — Epics

- Status: Done (approved by the owner on 2026-11-14, questions 1 to 3 as proposed)
- Work-item: [WI-033](../work-items/WI-033-epics.md)
- Canonical docs: [0003](../canonical/0003-task-management.md) sections 2, 3, 4, 5, 9;
  [0001](../canonical/0001-ai-qa-agents-and-triage.md) section 3 (`tasks:read` reads epics);
  [0004](../canonical/0004-api-conventions.md) sections 3, 5, 6;
  [WT-03](../work-tracks/WT-03-board-core.md) decisions 4, 7, 13, 16, 18

## Approach

### 1. Data model

```
epics  id uuid pk, project_id uuid not null → projects (restrict),
       title text not null, description text not null default '',
       status text not null default 'open'  check in ('open', 'closed'),
       start_date date, target_date date,
       check epics_dates_ordered: start_date is null or target_date is null
                                  or target_date >= start_date
       version int not null default 1  check >= 1,
       created_by uuid → accounts (set null), created_at, updated_at
       index epics_project_idx on (project_id)

tasks  + epic_id uuid → epics (restrict)
       + index tasks_epic_idx on (epic_id)
```

Migration `0010_epics`. Epics are never deleted (doc 0003 lists create, edit and close),
so `restrict` only guards against a mistake; a closed epic keeps its tasks.

### 2. Fields and rules (decision 18)

- **Title**: trimmed, 1 to 200 characters. **Description**: Markdown, up to 50 000
  characters, kept as written (the task rules).
- **Status**: `open` (default) or `closed`. Closing and reopening is a `PATCH` of `status`.
- **Dates**: `startDate` and `targetDate`, each `YYYY-MM-DD` or `null` (doc 0004 section 3),
  validated with `z.iso.date()` and stored as `date`. When both are set the target is not
  before the start: a `400` with the field error `targetDate`, checked again by the
  database. A `PATCH` checks the pair as it will be after the change.
- **Progress** (decision 18): `{ doneTasks, totalTasks }`, counting the epic's tasks that
  are not deleted; a task is done when its column's category is `done` (doc 0003
  section 5). Computed on every read, with one grouped query for a whole list. Story points
  join it in WT-10.

### 3. Endpoints

| Operation                                 | Access         | Success | Specific errors                                                     |
| ----------------------------------------- | -------------- | ------- | ------------------------------------------------------------------- |
| `GET /api/v1/projects/{projectId}/epics`  | `tasks:read`   | `200`   | `400`, `404`                                                        |
| `POST /api/v1/projects/{projectId}/epics` | `epics:manage` | `201`   | `400`, `404`, `409 project_archived`, `415`                         |
| `GET /api/v1/epics/{epicId}`              | `tasks:read`   | `200`   | `400`, `404`                                                        |
| `PATCH /api/v1/epics/{epicId}`            | `epics:manage` | `200`   | `400`, `404`, `409 version_conflict`, `409 project_archived`, `415` |

Reading epics is `tasks:read`, as doc 0001 section 3 says ("Read tasks, epics and comments");
every human role has it.

```ts
epicStatus  = "open" | "closed"                                           // "EpicStatus"
epic        = { id, projectId, title, description, status,
                startDate: date | null, targetDate: date | null,
                progress: { doneTasks, totalTasks }, version, createdAt, updatedAt }  // "Epic"
epicPage    = page of epic                                                // "EpicPage"
epicQuery   = paginationQuery & { status?: "open" | "closed" | "all" }    // default "open"
createEpic  = { title, description?, startDate?: date | null, targetDate?: date | null }
updateEpic  = { title?, description?, status?, startDate?, targetDate?, version }  // a field besides version
```

- **List**: ordered by title ignoring case under `"C"`, then id, with the name cursor of
  WS-026 (the same rule as people, teams and projects). By default only open epics;
  `status=closed` or `all` on request. Lists include `description`: an epic list is short
  and the epics page (WI-039) shows it.
- **Write steps**: `lockWritableProject` (shared) first, so an archived project is
  `project_archived`; `PATCH` locks the epic row and compares `version` (the WS-030 edit
  pattern), answering `version_conflict` with the current epic as `current`. A `PATCH` that
  changes nothing bumps `version` with no audit entry.

### 4. A task's epic

- `createTask` and `PATCH /api/v1/tasks/{taskId}` take `epicId` (`uuid`; on `PATCH`, `null`
  takes the task out of its epic). The epic must belong to the task's project, else `400`
  with the field error `epicId`. Open and closed epics both accept tasks (question 1).
- `Task` and `TaskSummary` gain `epic: { id, title } | null` (`EpicRef`). Additive.
- History: a change of epic records `field_changed` with `field` `epicId` and the old and
  new ids (decision 13), like the other fields of WS-030.
- Sub-tasks belong to their parent's epic (doc 0003 section 7) from WT-09 on; nothing to do
  here.

### 5. Audit (decision 16)

Entity `epic`, entity id the epic id.

| Action          | When                        | `data`                                  |
| --------------- | --------------------------- | --------------------------------------- |
| `epic.created`  | create                      | `{ projectId, title }`                  |
| `epic.updated`  | title, description or dates | `{ projectId, changed: [field names] }` |
| `epic.closed`   | status `open` → `closed`    | `{ projectId }`                         |
| `epic.reopened` | status `closed` → `open`    | `{ projectId }`                         |

A `PATCH` that changes the status and other fields writes both entries.

### 6. Out of scope

Filtering or grouping the board by epic (WT-08 filters); the epics page (WI-039); showing
the epic on the task page (WI-038).

## Files

| Path                                                      | Change                                               |
| --------------------------------------------------------- | ---------------------------------------------------- |
| `src/server/db/schema/epics.ts`, `tasks.ts`, `index.ts`   | create, modify, modify                               |
| `src/server/db/migrations/0010_epics.sql` (+ meta)        | create (`pnpm db:generate`)                          |
| `src/lib/schemas/epics.ts` (+ `.test.ts`)                 | create: schemas and contracts                        |
| `src/lib/schemas/tasks.ts` (+ test)                       | modify: `epicId`, `epic`                             |
| `src/lib/schemas/audit.ts` (+ test)                       | modify: four actions                                 |
| `src/lib/openapi/contracts.ts`                            | modify: four contracts                               |
| `src/server/services/epics.ts` (+ `.integration.test.ts`) | create                                               |
| `src/server/services/tasks.ts` (+ tests)                  | modify: `epicId` on create and edit, `epic` in reads |
| `src/app/api/v1/projects/[projectId]/epics/route.ts`      | create                                               |
| `src/app/api/v1/epics/[epicId]/route.ts`                  | create                                               |
| route integration tests                                   | create                                               |
| `docs/api/openapi.json`                                   | regenerate                                           |
| `docs/README.md`, WI-033, WS-033, WT-03                   | modify: statuses                                     |

No new dependency, no new problem code.

## Data model changes

Section 1, migration `0010_epics`.

## API contract

Sections 3 and 4. All additive: four operations, the schemas `EpicStatus`, `Epic`,
`EpicPage`, `EpicRef`, `CreateEpicRequest`, `UpdateEpicRequest`, `EpicVersionConflict`,
and `epicId` / `epic` on tasks.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                                                                                   | Covers criterion |
| --- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit        | schemas: title 1..200, description up to 50 000, dates `YYYY-MM-DD` or `null`, target before start refused on `targetDate`, update needs version and a field, status enum, query `status`                                              | validation       |
| 2   | unit        | contracts: reads `tasks:read`, writes `epics:manage`; `PATCH` documents `EpicVersionConflict`; tasks schemas carry `epicId` and `epic`                                                                                                 | access           |
| 3   | integration | database: an epic with the target before the start is refused by the check                                                                                                                                                             | dates            |
| 4   | integration | `createEpic`: defaults, audit `epic.created`; Member `403`; archived project `project_archived`                                                                                                                                        | create           |
| 5   | integration | `updateEpic`: title and dates with `epic.updated` listing changed fields; close and reopen with their own entries; stale version `version_conflict` with `current`; a `PATCH` that moves the target before the existing start is `400` | edit             |
| 6   | integration | progress: tasks in `todo` and `done` columns, a deleted one not counted, a task moved to done changes the count                                                                                                                        | progress         |
| 7   | integration | list: open by default, `closed` and `all` on request, by title ignoring case, pages join up                                                                                                                                            | list             |
| 8   | integration | tasks: created in an epic, moved out with `null` and into another, each a `field_changed` on `epicId`; an epic of another project is `400`; `epic` shown in list and read                                                              | task's epic      |
| 9   | integration | a failing audit write rolls back an epic change                                                                                                                                                                                        | audit            |
| 10  | integration | routes: statuses and bodies; Viewer and Member `403` on writes, `200` on reads; `401` without a session                                                                                                                                | endpoints        |

## Risks and open questions

1. **Closed epics still accept tasks.** Proposed: closing describes the epic, it does not
   lock it. The alternative is a `409` for putting a task in a closed epic.
2. **The epic list shows open epics by default.** `status=all` shows every epic.
3. **Epics cannot be deleted**, only closed, as doc 0003 lists.

## Deviations from the approved spec

- **Progress is computed with two correlated subqueries per epic** inside the one query that
  reads the epics, rather than a separate grouped query. Same result, one round trip, and
  the same SQL serves a single epic and a list.

## Implementation record

- Red: the schema, contract, audit-list and OpenAPI tests failed on the missing epic schemas,
  `epicId` and actions; the integration tests on the missing service and routes (committed
  before any code).
- Green: 690 Vitest tests (up from 671) and 28 Playwright tests pass, with no unhandled
  errors. Typecheck, lint and format pass; `pnpm db:generate` leaves no diff after
  `0010_epics`; `pnpm openapi:generate` adds the four operations and the epic schemas.
- One test of mine first compared the whole audit log and also saw the setup's
  `project.created`; it now looks at epic entries only.
- Locally the database was PostgreSQL 16 (no Docker in the sandbox); CI runs the
  PostgreSQL 18 of `compose.yaml`.
