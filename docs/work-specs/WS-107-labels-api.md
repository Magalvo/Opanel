# WS-107 — Labels in the data model and API

- Status: Proposed
- Work-item: [WI-107](../work-items/WI-107-labels-api.md)
- Canonical docs: [0003](../canonical/0003-task-management.md) sections 3, 4, 9;
  [0004](../canonical/0004-api-conventions.md) sections 4, 6, 8;
  [0002](../canonical/0002-realtime-sync.md) section 4;
  [WT-07](../work-tracks/WT-07-backlog-priority-due-dates-labels.md) decisions 8 to 12,
  questions 3, 5 and 6

## Approach

### 1. Order of work

Items A (WI-101) and B (WI-102) are on `main`, so this item starts from `main` and its
migration is `0021_labels`. Items D, E and F can follow in parallel once it merges.

### 2. The data

```
labels(id uuid pk, project_id uuid not null references projects on delete cascade,
       name text not null, colour text not null, version int not null default 1,
       created_at, updated_at)
  unique index labels_project_name_lower_idx on (project_id, lower(name))
  check labels_colour_check: colour in the palette
task_labels(task_id uuid references tasks on delete cascade,
            label_id uuid references labels on delete cascade,
            primary key (task_id, label_id))
  index task_labels_label_idx on (label_id)
```

- **Name.** Trimmed, 1 to 40 characters; unique per project ignoring case, as team names
  are (`teams_name_lower_idx`). A label may change only the case of its own name.
- **Colour.** One of `gray`, `red`, `orange`, `amber`, `green`, `teal`, `blue`, `indigo`,
  `purple`, `pink`, stored by name (WT-07 question 3). Item F gives each a light and a dark
  rendering. Optional on create, `gray` by default, so item F's picker can create a label
  from its name alone.
- **Limits.** 200 labels per project (`409 too_many_labels`, counted under the project's
  lock); 20 per task (the request schema's `max(20)`).
- **Same project.** A task's labels are labels of its project. The service checks it; no
  database constraint spans the two tables.

### 3. The labels API

| Operation                                  | Permission      | Answers                                                                                                       |
| ------------------------------------------ | --------------- | ------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/projects/{projectId}/labels`  | `tasks:read`    | `200` `LabelList`: every label, by `lower(name)` then `id`, `nextCursor: null` (a bounded list, like columns) |
| `POST /api/v1/projects/{projectId}/labels` | `labels:write`  | `201` `Label`; `409 label_name_taken`, `too_many_labels`, `project_archived`                                  |
| `PATCH /api/v1/labels/{labelId}`           | `labels:manage` | `200` `Label`; `409 version_conflict` (`current`: the label), `label_name_taken`, `project_archived`          |
| `DELETE /api/v1/labels/{labelId}`          | `labels:manage` | `204`; `409 project_archived`                                                                                 |

`DELETE` takes no `version`, as every other `DELETE` of the API (question 1). Each write
locks the project with `lockWritableProject`, which checks the project restriction
(`403`) and archiving. An unknown label is `404`. Viewers and agents hold neither label
permission, so every write is `403` for them.

Schemas in a new `src/lib/schemas/labels.ts`: `LabelColour`, `Label`
(`id, projectId, name, colour, version, createdAt, updatedAt`), `LabelRef`
(`id, name, colour`), `LabelList`, `CreateLabelRequest` (`name`, `colour?`) and
`UpdateLabelRequest` (`name?`, `colour?`, `version`, at least one of the first two).

### 4. Audit and events

- `label.created` (details: name, colour), `label.updated` (old and new name and colour,
  only what changed), `label.deleted` (name, and `tasks`: how many tasks it was removed
  from), appended to `AUDIT_ACTIONS`.
- `label.changed` (entity `label`, the label's `version`, `null` when deleted) joins
  `projectEventSchema` and `PROJECT_EVENT_TYPES`, sent by each write. The pages that take
  project events (the board, the task detail, the project settings, the epics page) do
  nothing with it until item F shows labels; where one switches on the type, the new case
  is an explicit no-op. A test checks that the board's state is unchanged by it.

### 5. Labels on tasks

- **Answers.** `TaskSummary` (so `Task` too) gains `labels: LabelRef[]`, required,
  ordered by `lower(name)` then `id`. `TASK_SELECT` adds a subquery,
  `coalesce((select json_agg(...) from task_labels join labels ...), '[]')`, so every
  answer that already reads it has the labels, and a rename shows with no task write.
- **Requests.** `labelIds?: uuid[]` (unique, at most 20) on `CreateTaskRequest` and
  `UpdateTaskRequest`; on `PATCH` it is a valid change alone. It is the whole set: `[]`
  removes every label.
- **Permission.** When `labelIds` is present, `createTask` and `updateTask` also call
  `requirePermission(actor, "labels:write")`, before any read (WT-07 decision 10).
- **Checks.** Every id must be a label of the task's project, else `400` with
  `path: "labelIds"` ("Not a label of this project.").
- **History.** On create, the `created` entry gains `labels: [{ id, name }]` when sent. On
  `PATCH`, a changed set is one `field_changed` entry, `field: "labels"`, old and new
  values as `[{ id, name }]` by name, so the WT-08 timeline reads a label's name after it
  is deleted. The same set, in any order, records nothing, as for any field sent
  unchanged. One `PATCH` is still one `version` and one `task.updated`.
- **The triage pipeline** sets no labels; nothing changes there.

### 6. Deleting a label in use

In one transaction, under the project's exclusive lock: read the tasks that have the label,
deleted ones included, with their labels; then for each, remove the row, record the
`field_changed` entry (actor: the Manager) and add one to its `version`; delete the label;
audit it with the count; send `label.changed`, then `task.updated` for each task that is
not deleted. A deleted task is on no board or backlog, so it gets no event, but its
history and version stay true for a restore (question 2). Test 12 measures it with 1 000
labelled tasks and records the time.

### 7. The MCP tools

The MCP server builds its write tools from the request schemas (WS-104), so
`opanel_create_task` and `opanel_update_task` would gain `labelIds`, which no agent may send
(WT-07 question 5): every call with it would be a `403`. Their input schemas drop it
(`.omit({ labelIds: true })`), as doc 0005 says tools offer nothing that can only fail
(question 3). The answers parse `labels` with the shared schema like any field; the
package's task fixture gains `labels: []`. Listing labels for agents stays the WT-11
follow-up `opanel_list_labels`.

### 8. The web app

`labels` reaches `TaskSummary`, so the fixtures that build one gain `labels: []`
(`board/test-data.ts`, `board/moves.test.ts`, `project-settings.test.tsx`,
`account-ref.test.ts` and the others the type checker names). Nothing is shown yet
(item F).

## Files

| Path                                                                                  | Change                                      |
| ------------------------------------------------------------------------------------- | ------------------------------------------- |
| `src/lib/schemas/labels.ts`, `labels.test.ts`                                         | create                                      |
| `src/lib/schemas/tasks.ts`, `tasks.test.ts`                                           | modify: `labels`, `labelIds`                |
| `src/lib/schemas/audit.ts`, `events.ts`, `problem.ts` and their tests                 | modify: actions, `label.changed`, two codes |
| `src/lib/openapi/contracts.ts` (or where contracts are listed)                        | modify: four operations                     |
| `src/server/db/schema/labels.ts`, `index.ts`                                          | create, modify                              |
| `src/server/db/migrations/0021_labels.sql`, `meta/`                                   | create (`pnpm db:generate`)                 |
| `src/server/http/errors.ts`                                                           | modify: `labelNameTaken`, `tooManyLabels`   |
| `src/server/services/labels.ts`, `labels.integration.test.ts`                         | create                                      |
| `src/server/services/tasks.ts`, `task-labels.integration.test.ts`                     | modify, create                              |
| `src/app/api/v1/projects/[projectId]/labels/route.ts`, its integration test           | create                                      |
| `src/app/api/v1/labels/[labelId]/route.ts`, its integration test                      | create                                      |
| `src/app/api/v1/tasks/[taskId]/route.integration.test.ts`                             | modify: `labelIds` by a Member, an agent    |
| `src/components/board/use-board.ts`, `use-board.test.tsx`, other listeners            | modify: `label.changed` is a no-op          |
| `mcp/src/tools/create-task.ts`, `update-task.ts`, `testing.ts`, `write-tools.test.ts` | modify: no `labelIds`; the fixture          |
| `docs/api/openapi.json`                                                               | regenerate                                  |
| The fixtures of section 8                                                             | modify                                      |
| `docs/work-items/WI-107-labels-api.md`, this file                                     | status                                      |

## Data model changes

Migration `0021_labels` (`pnpm db:generate`): the two tables, the unique index on
`(project_id, lower(name))`, the colour check, the index on `task_labels(label_id)`. No
backfill: tasks start with no labels.

## API contract

| Operation                                 | Change                                         |
| ----------------------------------------- | ---------------------------------------------- |
| Every answer with `Task` or `TaskSummary` | `labels: LabelRef[]`                           |
| `POST /api/v1/projects/{projectId}/tasks` | optional `labelIds` (needs `labels:write` too) |
| `PATCH /api/v1/tasks/{taskId}`            | optional `labelIds` (needs `labels:write` too) |
| The four label operations of section 3    | new                                            |
| Problem codes                             | new: `label_name_taken`, `too_many_labels`     |
| Event types                               | new: `label.changed`                           |

All additions (doc 0004 section 8). The new permissions were already in the catalogue.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                                                                                                                                                                                          | Covers criterion |
| --- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit        | label schemas: a name of 41 characters or only spaces is refused, one is trimmed; `colour` refuses `black`, defaults to `gray`; `UpdateLabelRequest` needs `name` or `colour`                                                                                                                                                                 | 2                |
| 2   | unit        | task schemas: `labels` required in both answers; `labelIds` refuses 21 ids, a repeated id, a non-UUID; `PATCH` with `{ labelIds: [], version }` alone is valid                                                                                                                                                                                | 4, 6             |
| 3   | unit        | `label.changed` parses with a version and with `null`; the audit actions and problem codes are listed                                                                                                                                                                                                                                         | 3                |
| 4   | integration | the migration: `labels_colour_check` refuses `black`; two names differing in case in one project violate the unique index, in two projects do not; deleting a task removes its `task_labels` rows                                                                                                                                             | 1                |
| 5   | integration | `createLabel`, `listLabels`, `updateLabel`, `deleteLabel`: a Member creates; the list is by name; a Manager renames (also only the case) and recolours; each write is audited and sends `label.changed`                                                                                                                                       | 2, 3             |
| 6   | integration | refusals: a Member's `PATCH` and `DELETE` and every write by a Viewer and an agent are `403`; a duplicate name `409 label_name_taken`; the 201st label `409 too_many_labels`; a stale `version` `409` with `current`; an archived project `409 project_archived`; a restricted agent's `GET` on another project `403`; an unknown label `404` | 2                |
| 7   | integration | `createTask` with `labelIds` answers them by name and its `created` entry names them; without, `labels: []`                                                                                                                                                                                                                                   | 4, 5, 6          |
| 8   | integration | `updateTask` sets, replaces and clears labels: one `field_changed` entry each with old and new `{ id, name }` lists; the same set in another order records nothing; one version per `PATCH`                                                                                                                                                   | 4, 5             |
| 9   | integration | a label of another project, or an unknown id, is `400` naming `labelIds`; an agent with `tasks:write` sending `labelIds` is `403`, without it is `200`                                                                                                                                                                                        | 4                |
| 10  | integration | `labels` comes back from get, the board list, the backlog, move, restore and a `409`'s `current`; a rename and a recolour show in them without changing the task's `version`                                                                                                                                                                  | 6                |
| 11  | integration | deleting a label on three tasks, one of them deleted: all lose it, each gets a `field_changed` entry by the Manager and a new `version`; `task.updated` for the two live ones; the audit entry counts 3                                                                                                                                       | 7                |
| 12  | integration | deleting a label on 1 000 tasks completes in one transaction; the time is recorded in this file                                                                                                                                                                                                                                               | 7                |
| 13  | integration | the routes: the four label operations by a Member's cookie and an Admin's; `POST /tasks` and `PATCH` with `labelIds` by a Member (`200`) and by an agent token with `tasks:write` (`403`)                                                                                                                                                     | 2, 4             |
| 14  | unit        | the board's state is unchanged by a `label.changed` event, during and outside a load                                                                                                                                                                                                                                                          | 3                |
| 15  | unit        | the MCP tools: `opanel_create_task` and `opanel_update_task` refuse `labelIds` without a request; a task answer with labels parses                                                                                                                                                                                                            | 8                |
| 16  | unit        | the OpenAPI document: `Label`, `LabelRef`, `LabelColour`, the four operations with their permissions and `409` codes, `labels` and `labelIds` on tasks; `docs/api/openapi.json` regenerated                                                                                                                                                   | 8                |
| 17  | gate        | `pnpm check`, `pnpm test`, `pnpm test:e2e`; `pnpm db:generate` and `pnpm openapi:generate` leave no diff                                                                                                                                                                                                                                      | all              |

## Risks and open questions

1. **`DELETE` and `version`.** WT-07 decision 9 says the label's `PATCH` and `DELETE` each
   take a `version`. No `DELETE` of the API takes one (columns, teams, tasks, tokens), doc
   0004 section 6 puts `version` in the body, and a body on `DELETE` is often dropped by
   proxies and clients. **Recommend: `PATCH` takes `version`; `DELETE` does not**, and
   WT-07's decision 9 is read that way. Alternative: `DELETE ...?version=N`, a first for
   the API.
2. **A deleted task that has the label.** It is on no board, but a restore would show it
   again. **Recommend: it loses the label too, with its history entry and a new
   `version`, but no `task.updated` (section 6).** Alternative: leave its row to the
   database's cascade with no history, so a restored task's history would not say where
   the label went.
3. **`labelIds` in the MCP tools.** **Recommend: drop it from the tools' inputs (section 7)**, since no agent role holds `labels:write`. Alternative: keep it, so a future agent
   scope needs no MCP change, at the cost of a tool argument that always fails today.
4. **The palette.** **Recommend the ten colours of section 2**, the ones WT-07 question 3
   gave as its example, and `gray` as the default on create.

Risks:

- **`TASK_SELECT` gains a subquery per task.** The board loads every task; the subquery
  reads `task_labels` by its primary key's first column, so it is an index lookup per
  task. Test 12 sets 1 000 labelled tasks up; the board list's time on them is recorded
  with it.
- **Items D, E and F** start from this item's `TaskSummary`; whichever of them is in
  flight takes in `main` before merging (`AGENTS.md` section 8).
