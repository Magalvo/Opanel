# WS-140 — Sprints in the API

- Status: Proposed
- Work-item: [WI-140](../work-items/WI-140-sprints-api.md)
- Canonical docs: [0003](../canonical/0003-task-management.md) sections 3 ("create,
  start, complete sprints; enable sprints on a project") and 6 (sprints);
  [0002](../canonical/0002-realtime-sync.md) section 3 (the event contract, amended here by
  WT-10 proposal P3); [0004](../canonical/0004-api-conventions.md) sections 4 to 6;
  [0001](../canonical/0001-ai-qa-agents-and-triage.md) section 3 (agent scopes);
  [WT-10](../work-tracks/WT-10-sprints-and-story-points.md) decisions 3, 4, 8, 10 to 12

## Approach

### 1. Starting point, checked against `main` (`5834e80`)

- No sprint table or endpoint exists. `sprints:manage` is in the permission catalogue,
  held by Managers and Admins, by no agent scope, and checked nowhere.
- `projects` (`src/server/db/schema/projects.ts`) has no setting; `updateProject`
  (`src/server/services/projects.ts`) needs `projects:manage`, changes a name and a
  description with `version`, writes `project.updated` with the changed fields, and sends
  `project.changed`.
- Epics are the model for a project's child entity: `src/lib/schemas/epics.ts` (schemas
  and `EndpointContract`s), `src/server/services/epics.ts` (`lockWritableProject` for
  writes, `findProjectRef` and `requireProjectAccess` for reads, `recordAudit`,
  `publishEvent`), and two route files under `src/app/api/v1`.
- `projectEventSchema` (`src/lib/schemas/events.ts`) is a discriminated union; the board's
  and the backlog's `switch`es over it (`use-board.ts`, `use-backlog.ts`) name every type,
  so a new type needs a case in each.
- `PROBLEM_CODES` ends with `too_many_subtasks`; `scripts/api-conventions.test.ts` checks
  doc 0004 section 4's table against it. `AUDIT_ACTIONS` holds no sprint action.
- The last migration is `0025_task_links_types`. Item A (WI-139) adds one in parallel:
  whichever merges second deletes its own and runs `pnpm db:generate` again (`AGENTS.md`
  section 8).

### 2. The data

Migration `0026_sprints`:

- `projects.sprints_enabled boolean not null default false`;
- `sprints`: `id uuid` primary key; `project_id` → `projects` (`restrict`); `name text`;
  `goal text not null default ''`; `start_date date`, `end_date date`, both not null;
  `state text not null default 'planned'`; `started_at`, `completed_at` timestamps, null;
  `total_points`, `completed_points` `numeric(7,1)`, null; `version int not null default
1`; `created_by` → `accounts` (`set null`); `created_at`, `updated_at`;
- checks: `sprints_state_check` (`planned`, `active`, `completed`);
  `sprints_dates_ordered` (`end_date >= start_date`); `sprints_version_positive`;
  `sprints_completed_check` (`completed_at`, `total_points` and `completed_points` are set
  exactly when the state is `completed`); `sprints_started_check` (`started_at` is null
  exactly when the state is `planned`);
- `sprints_one_active_idx`: unique on `(project_id)` where `state = 'active'` (WT-10
  decision 3);
- `sprints_project_order_idx` on `(project_id, start_date, created_at, id)`, which the list
  reads.

The start, completion and frozen-point columns are written only by item D; they are here
so the table is made once (question 1). `tasks.sprint_id` is item C's.

### 3. The schemas

In a new `src/lib/schemas/sprints.ts`:

- `sprintNameSchema` (trimmed, 1 to 100), `sprintGoalSchema` (up to 2 000, Markdown),
  `sprintStateSchema` (`SprintState`);
- `sprintSchema` (`Sprint`): `id`, `projectId`, `name`, `goal`, `startDate`, `endDate`,
  `state`, `startedAt`, `completedAt` (nullable), `version`, `createdAt`, `updatedAt`.
  Points come with item D (section 9);
- `createSprintRequestSchema`: `name`, `goal` (optional), `startDate`, `endDate`, with the
  date-order rule as a `400` on `endDate`;
- `updateSprintRequestSchema`: each of the four optional, `version` required, at least one
  field; the order is checked in the service against the stored dates, as epics do;
- `sprintQuerySchema`: pagination and `state`, one or many;
- the five `EndpointContract`s, each naming its permission and its codes.

`projectSchema` gains `sprintsEnabled: boolean`; `updateProjectRequestSchema` gains
`sprintsEnabled` (optional), and its rule becomes "Send at least one field to change."

### 4. The setting

`updateProject` checks permissions by field: `name` and `description` need
`projects:manage`, `sprintsEnabled` needs `sprints:manage` (doc 0003 section 3). Today both
are held by the same roles; the split keeps the table's rows true. Inside the transaction
that already locks the project:

- turning it off when the project has an `active` sprint is `409 sprint_active`;
- a change writes `sprintsEnabled` into `project.updated`'s `changed` list and sends
  `project.changed`, as a rename does.

Turning it on with tasks on the board makes "Sprint 1" in item D (WT-10 decision 6); until
then the setting changes nothing that the board or the backlog reads.

### 5. Sprint writes

A new `src/server/services/sprints.ts`, each write in one transaction that takes
`lockWritableProject` (so an archived project is `409 project_archived`) and needs
`sprints:manage`:

- **Create**: a project with `sprints_enabled = false` is `409 sprints_disabled`. Inserts
  a `planned` sprint, writes `sprint.created` (`{ projectId, name }`), sends
  `sprint.changed` with version 1.
- **Edit**: locks the sprint `for update`, checks `version` (`409 version_conflict` with
  the sprint as it is); a `completed` sprint is `409 sprint_completed`; a project without
  sprints is `409 sprints_disabled`; the resulting dates out of order are a `400` on
  `endDate`. Writes `sprint.updated` with the changed fields when any changed.
- **Delete**: locks the sprint; only a `planned` one may go (`409 sprint_not_planned`);
  `version` is not asked, as for labels. Writes `sprint.deleted` (`{ projectId, name }`),
  sends `sprint.changed` with `version: null`. Item C adds "its tasks become unscheduled"
  to this transaction.

### 6. Sprint reads

Both need `tasks:read`, like epics (WT-10 decision 10). `GET
/projects/{projectId}/sprints` resolves the project with `findProjectRef` (restricted
agents: `404` outside their projects, as for epics), filters by `state`, and orders by
`start_date`, `created_at`, `id` ascending with a cursor of those three (question 2).
`GET /sprints/{sprintId}` answers `404` for an unknown sprint and `403` outside a
restricted agent's projects (`requireProjectAccess`), as `getEpic` does.

### 7. The event

`projectEventSchema` gains `sprintChanged`: `type: "sprint.changed"`, `entity: "sprint"`,
`version` nullable ("`null` when the sprint was deleted"). `use-board.ts` and
`use-backlog.ts` gain the case beside `epic.changed`, doing nothing yet: what they read
does not depend on sprints until items C and E. Doc 0002 section 3 gains the row of WT-10
proposal P3 in this item, since this item adds the event (question 3).

### 8. Audit and codes

`AUDIT_ACTIONS` gains `sprint.created`, `sprint.updated`, `sprint.deleted` (item D adds
`sprint.started` and `sprint.completed`). `PROBLEM_CODES` gains `sprints_disabled`,
`sprint_active`, `sprint_not_planned` and `sprint_completed`, each a `409`, and doc 0004
section 4's table names them.

### 9. What waits for later items

- The sprint's points (`totalPoints`, `donePoints`, `unestimated`, `taskCount`) need
  `tasks.sprint_id` (item C) and story points (item A), so `Sprint` gains them in item D.
- `docs/agents.md` gains sprints in item G; this item adds nothing that its doc check
  requires.
- `opanel_list_sprints` is item F.

## Files

| Path                                                                         | Change                            |
| ---------------------------------------------------------------------------- | --------------------------------- |
| `src/server/db/schema/sprints.ts`, `schema/projects.ts`, `schema/index.ts`   | create, modify: section 2         |
| migration `0026_sprints`                                                     | create                            |
| `src/lib/schemas/sprints.ts`                                                 | create: section 3                 |
| `src/lib/schemas/projects.ts`                                                | modify: `sprintsEnabled`          |
| `src/lib/schemas/events.ts`, `audit.ts`, `problem.ts`                        | modify: sections 7 and 8          |
| `src/server/services/sprints.ts`                                             | create: sections 5 and 6          |
| `src/server/services/projects.ts`                                            | modify: section 4                 |
| `src/app/api/v1/projects/[projectId]/sprints/route.ts`                       | create: `GET`, `POST`             |
| `src/app/api/v1/sprints/[sprintId]/route.ts`                                 | create: `GET`, `PATCH`, `DELETE`  |
| `src/lib/openapi/` (the document's paths)                                    | modify: the five operations       |
| `src/components/board/use-board.ts`, `src/components/backlog/use-backlog.ts` | modify: the `sprint.changed` case |
| `src/server/db/schema/sprints.integration.test.ts`                           | create: test 1                    |
| `src/server/services/sprints.integration.test.ts`                            | create: tests 2 to 9              |
| `src/server/services/projects.integration.test.ts`                           | modify: tests 10 and 11           |
| the two new route tests, `viewer-writes.integration.test.ts`                 | create, modify: test 12           |
| `src/lib/openapi/document.test.ts`                                           | modify: test 13                   |
| `docs/canonical/0002-realtime-sync.md`, `0004-api-conventions.md`            | modify: P3, the four codes        |
| project fixtures (UI and `mcp/src/testing.ts`)                               | modify: `sprintsEnabled`          |

## Data model changes

Migration `0026_sprints`: `projects.sprints_enabled`; the `sprints` table, its five checks
and two indexes.

## API contract

| Method and path                             | Permission       | Answers                                                                         |
| ------------------------------------------- | ---------------- | ------------------------------------------------------------------------------- |
| `PATCH /api/v1/projects/{projectId}`        | by field         | `sprintsEnabled`; `409 sprint_active`                                           |
| `GET /api/v1/projects/{projectId}/sprints`  | `tasks:read`     | `SprintPage`; `state` filter                                                    |
| `POST /api/v1/projects/{projectId}/sprints` | `sprints:manage` | `201 Sprint`; `400`; `409 sprints_disabled`, `project_archived`                 |
| `GET /api/v1/sprints/{sprintId}`            | `tasks:read`     | `Sprint`; `404`; `403`                                                          |
| `PATCH /api/v1/sprints/{sprintId}`          | `sprints:manage` | `Sprint`; `400`; `409 sprint_completed`, `sprints_disabled`, `version_conflict` |
| `DELETE /api/v1/sprints/{sprintId}`         | `sprints:manage` | `204`; `409 sprint_not_planned`                                                 |

`Project.sprintsEnabled`; the `sprint.changed` event. New fields, endpoints, codes and an
event type: not breaking (doc 0004 section 8).

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                   | Covers criterion |
| --- | ----------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | integration | the database refuses a second active sprint in a project, dates out of order, a completed sprint without frozen points | 6                |
| 2   | integration | a Manager creates a sprint; the answer, the audit entry and the `sprint.changed` event                                 | 2, 7             |
| 3   | integration | create refusals: dates out of order (`400` on `endDate`), sprints off (`409 sprints_disabled`), archived project       | 2, 8             |
| 4   | integration | the list orders by start date, then creation, pages with a cursor, and filters by one or many states                   | 3                |
| 5   | integration | edit: each field, the audit's changed list, the event; a stale version; stored dates out of order after the edit       | 4, 7             |
| 6   | integration | edit of a completed sprint is `409 sprint_completed` (state set in the database)                                       | 4                |
| 7   | integration | delete: a planned sprint goes, with audit and `version: null` event; active and completed are `409 sprint_not_planned` | 5, 7             |
| 8   | integration | a Member, a Viewer and a `worker_agent` read sprints and get `403` on every write                                      | 8                |
| 9   | integration | a restricted agent gets `404` for another project's list and `403` for its sprint                                      | 8                |
| 10  | integration | the setting: on and off by a Manager, `project.updated` with `sprintsEnabled`, `project.changed`; `403` for a Member   | 1                |
| 11  | integration | turning sprints off with an active sprint (set in the database) is `409 sprint_active`, nothing written                | 6                |
| 12  | integration | the routes: bodies and params read, `201` and `204`, each code; every new write in the Viewer-writes list              | 2 to 5, 8        |
| 13  | unit        | the OpenAPI document: the five operations, `Sprint`, `sprintsEnabled`, the four codes, the event                       | 9                |

`scripts/api-conventions.test.ts` checks the codes in doc 0004 with no new test.

## Risks and open questions

Questions for the owner, each with a recommendation:

1. **The table's later columns.** **Recommend: create `started_at`, `completed_at` and
   the frozen points here (section 2)**, written only by item D, so the table is made in
   one migration; the alternative is a second migration in item D.
2. **The list's order.** WT-10 decision 3 orders planned sprints by start date. **Recommend:
   one order for every state, start date then creation, with the `state` filter**; the UI
   asks for `planned` and `active` together, and `completed` apart. The alternative is
   completed sprints newest first, which needs a second order and cursor.
3. **When doc 0002 gains `sprint.changed`.** WT-10 says item G applies the proposals, but
   this item adds the event, and a doc that disagrees with the code must not be left
   (`AGENTS.md` rule 11). **Recommend: apply P3 here**, and P1, P2 and P4 stay with item G.
4. **Writes while sprints are off.** **Recommend: create and edit answer
   `409 sprints_disabled`; delete still works**, so a Manager can clear planned sprints
   kept from before (WT-10 decision 4).

Risks:

- **`Project` gains a required field**, so every fixture of it changes. New fields are not
  breaking for clients.
- **The setting can be turned on before item C or D merges.** It then changes nothing a
  client reads; item C's work-spec decides how its board rule treats a project turned on
  before item D's "Sprint 1" exists.
- **A migration beside item A's**: the second to merge regenerates its own, as section 1
  says.
