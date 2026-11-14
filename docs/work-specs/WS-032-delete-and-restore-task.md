# WS-032 — Delete and restore a task

- Status: Approved (approved by the owner on 2026-11-14, questions 1 to 3 as proposed)
- Work-item: [WI-032](../work-items/WI-032-delete-and-restore-task.md)
- Canonical docs: [0003](../canonical/0003-task-management.md) sections 3, 9, 13;
  [0004](../canonical/0004-api-conventions.md) sections 5, 6;
  [WT-03](../work-tracks/WT-03-board-core.md) decisions 4, 11, 12, 13;
  [WS-030](WS-030-tasks-core.md) question 4 (approved)

## Approach

`tasks.deleted_at` and `tasks.deleted_by` exist since WI-030, and every read already
ignores deleted tasks. This item adds the writes, the list of deleted tasks, and the rules
for columns. No migration.

### 1. Operations

| Operation                                             | Contract access         | Success | Specific errors                             |
| ----------------------------------------------------- | ----------------------- | ------- | ------------------------------------------- |
| `DELETE /api/v1/tasks/{taskId}`                       | `tasks:delete_own`      | `204`   | `400`, `403`, `404`, `409 project_archived` |
| `POST /api/v1/tasks/{taskId}/restore`                 | `tasks:delete_any`      | `200`   | `400`, `404`, `409 project_archived`        |
| `GET /api/v1/projects/{projectId}/tasks?deleted=true` | `tasks:read` (as today) | `200`   | `403` without `tasks:delete_any`            |

- **Who may delete** (doc 0003 section 3, resolved question 3). The contract declares the
  smaller permission, `tasks:delete_own`, which Members, Managers and Admins hold; the
  service then applies the existing `canDeleteTask` (`src/server/auth/actor.ts`, WS-012):
  with `tasks:delete_any`, any task; with only `tasks:delete_own`, a task whose reporter is
  the actor; otherwise `403`. The object-level rule stays in the service, as WS-025 intends.
- **Delete** takes no body and no `version` (doc 0004 section 6: `DELETE` returns `204`).
  A task that is already deleted, or unknown, is `404`, the same as for every other path:
  a deleted task is visible only through the deleted list and the restore operation
  (decision 12).
- **Restore** finds the task by id or key **including deleted ones**, and returns the
  restored `Task`. Restoring a task that is not deleted returns it unchanged, with no
  event, so a repeated click is harmless.
- **Deleted list**: `deleted=true` lists only deleted tasks, in board order, with the same
  pagination and `columnId` filter; it needs `tasks:delete_any`. The default
  (`deleted=false`) is unchanged. This is the list the project settings page shows
  (WI-036).
- **Response fields**: `TaskSummary` and `Task` gain `deletedAt` (datetime or `null`). It is
  `null` everywhere except in the deleted list. Additive (doc 0004 section 8).

### 2. Steps

**Delete**, in one transaction: find the live task (`404`), take the project's shared lock
(`409 project_archived`), lock the task row, check `canDeleteTask` (`403`), set
`deleted_at = now()`, `deleted_by` = the actor, `version + 1`, and record a `deleted`
event (no field, no values). The task keeps its column and position.

**Restore**, in one transaction: find the task including deleted (`404`), take the
project's shared lock, lock the row; if it is deleted, clear `deleted_at` and `deleted_by`,
bump `version`, and record a `restored` event. Its key, column and position are those it
had, so it reappears where it was. Its assignees are unchanged, even a person deactivated
meanwhile (shown as inactive, as in WS-030).

### 3. Deleted tasks and the column and team rules

Approved in WS-030 question 4:

- **A column whose tasks are all deleted can be deleted.** `deleteColumn` (WS-029) now
  counts live tasks: any live task is `409 column_not_empty`, as before. Deleted tasks in
  the column move, in their order, to the end of the project's first remaining column, each
  with a `moved` event by the actor, in the same transaction as the column's deletion. Column
  writes already hold the project's exclusive lock, which keeps creations, moves and
  restores out for the duration. The foreign key stays as the last guard.
- **A team keeps a deleted task's assignment.** `team_in_use` still counts every task. The
  problem's detail says so: "Tasks are assigned to this team, including deleted ones.
  Reassign them before deleting it." Restoring a task never finds its team gone.

### 4. History

`deleted` and `restored` are two of the six event types allowed since WI-030. Like every
event they record the acting account (hard rule 8); task events write no audit-log entry
(decision 16).

## Files

| Path                                                  | Change                                              |
| ----------------------------------------------------- | --------------------------------------------------- |
| `src/lib/schemas/tasks.ts` (+ `.test.ts`)             | modify: `deletedAt`, `deleted` query, two contracts |
| `src/lib/openapi/contracts.ts`                        | modify: two contracts                               |
| `src/server/services/tasks.ts` (+ integration test)   | modify: `deleteTask`, `restoreTask`, deleted list   |
| `src/server/services/columns.ts` (+ integration test) | modify: move deleted tasks out of a deleted column  |
| `src/server/http/errors.ts`                           | modify: `team_in_use` detail                        |
| `src/app/api/v1/tasks/[taskId]/route.ts`              | modify: `DELETE`                                    |
| `src/app/api/v1/tasks/[taskId]/restore/route.ts`      | create                                              |
| route integration tests                               | create / modify                                     |
| `docs/api/openapi.json`                               | regenerate                                          |
| `docs/README.md`, WI-032, WS-032, WT-03               | modify: statuses                                    |

No migration, no new dependency, no new problem code.

## Data model changes

None.

## API contract

Section 1. Additive: two operations, the `deleted` query parameter, and `deletedAt` on
`TaskSummary` and `Task`.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                                               | Covers criterion |
| --- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit        | list query accepts `deleted=true/false`; contracts: `DELETE` declares `tasks:delete_own`, restore `tasks:delete_any`; `deletedAt` in the schemas                                                   | contract         |
| 2   | integration | delete: gone from the list, id and key `404`, `deleted` event with the actor, `version` bumped; deleting again `404`                                                                               | delete           |
| 3   | integration | a Member deletes their own task but gets `403` on another's; a Manager deletes any; a Viewer `403`                                                                                                 | who may delete   |
| 4   | integration | deleted list: only deleted tasks, with `deletedAt`, board order; Member `403`                                                                                                                      | deleted list     |
| 5   | integration | restore: back in the same column and place with the same key, `restored` event, `version` bumped; restoring a live task changes nothing; Member `403`                                              | restore          |
| 6   | integration | archived project: delete and restore are `project_archived`                                                                                                                                        | archived         |
| 7   | integration | a column with one live task is `column_not_empty`; with only deleted tasks it is deleted and they move to the first column, in order, each with a `moved` event; restoring one then shows it there | column rule      |
| 8   | integration | a team assigned only to a deleted task is still `team_in_use`                                                                                                                                      | team rule        |
| 9   | integration | creating a task in a column that holds deleted tasks puts it after them (no shared position)                                                                                                       | positions        |
| 10  | integration | routes: `204`, `200`, `403`, `404`, `401` as documented                                                                                                                                            | endpoints        |

## Risks and open questions

1. **Restoring a live task is a silent success**, not a `409`. Proposed because the
   outcome the caller wants already holds.
2. **The deleted list is in board order**, not most recently deleted first. Proposed to
   reuse the list and its cursor; WT-08's filters and sorting can add another order.
3. **No hard delete.** Deleted tasks stay in the database for good in v1, as doc 0003 asks
   ("always a restorable soft delete").
