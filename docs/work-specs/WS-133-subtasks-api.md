# WS-133 — Sub-tasks in the API

- Status: Done (approved by the owner on 2026-11-26, questions 1 to 3 as recommended; done on
  2026-11-26)
- Work-item: [WI-133](../work-items/WI-133-subtasks-api.md)
- Canonical docs: [0003](../canonical/0003-task-management.md) sections 4 (`Parent`) and
  7 (sub-tasks); [0002](../canonical/0002-realtime-sync.md) section 3 (`task.updated`);
  [0004](../canonical/0004-api-conventions.md) sections 5 and 6;
  [WT-09](../work-tracks/WT-09-subtasks-and-links.md) decisions 1 to 5, 9 to 11 and
  questions 1, 2 and 6

## Approach

### 1. Starting point, checked against `main` (`4eed863`)

- `tasks` (`src/server/db/schema/tasks.ts`) has no parent column; the last migration is
  `0023_task_updated_index`.
- `createTask` and `updateTask` (`src/server/services/tasks.ts`) lock the project
  (shared), then the task `for update`, check `version`, write, record one
  `field_changed` entry per changed field (`EDITABLE`), and publish `task.updated`.
  `deleteTask` and `restoreTask` set and clear `deleted_at`.
- `taskSelect` builds every task row; `toSummary` makes `TaskSummary`, a strict object, so
  every fixture of it (the UI's `test-data.ts`, the MCP package's `testing.ts`) names each
  field.
- The activity (`src/server/services/activity.ts`, WS-117) names an id in a
  `field_changed` entry by a table per field (`assigneeTeamId: "teams"`,
  `epicId: "epics"`, …), with `name: null` when the row is gone.
- `taskFilterShape` (`src/lib/schemas/tasks.ts`) and `taskFilterWhere`
  (`src/server/services/task-filter.ts`) make the filters of every task list.
- `PROBLEM_CODES` (`src/lib/schemas/problem.ts`) ends with `too_many_labels`.
- Item B (links in the API) is specified in parallel and adds a migration too: whichever
  merges second deletes its own migration and runs `pnpm db:generate` again (`AGENTS.md`
  section 8).

### 2. The data

Migration `0024_task_parent`:

- `tasks.parent_task_id uuid null references tasks(id) on delete restrict`;
- `tasks_parent_not_self_check`: `parent_task_id is null or parent_task_id <> id`;
- `tasks_parent_idx` on `(parent_task_id)` where `parent_task_id is not null`, which the
  progress counts and the sub-task list read.

The other rules are the service's (WT-09 risk 2), each with an integration test.

### 3. Setting and clearing a parent

`parentId` joins `createTaskFields` and `updateTaskFields`: a task's id or key, or `null`
(clear). In `createTask` and `updateTask`, when `parentId` is given and is not the current
one:

1. Resolve it (`findTask`): unknown or deleted is a `400` on `parentId`, "No live task with
   this id or key."
2. Lock the two rows `for update` in id order (the task's own lock is already taken in
   `updateTask`; the parent's is taken here), so two writes that would chain three tasks
   cannot both pass.
3. Refuse, each a `400` on `parentId`: the parent is the task itself; the parent is in
   another project; the parent has a parent; the task has live sub-tasks.
4. Count the parent's live sub-tasks: a 101st is `409 too_many_subtasks` (WT-09 decision 3).
5. Set `parent_task_id`, copy the parent's `epic_id` (decision 2), and record a
   `field_changed` entry on `parentId` (old and new ids), and one on `epicId` when the
   epic changed.

`parentId: null` clears the parent and keeps the task's epic as it was.

### 4. The epic follows the parent

- In a write to a sub-task (or one that makes a task a sub-task), an `epicId` that differs
  from the parent's is a `400` on `epicId`: "A sub-task's epic is its parent's." The same
  value is accepted, so a client that sends the whole task still works (question 1).
- `updateTask` on a parent whose epic changes updates its live sub-tasks' `epic_id` in the
  same transaction (at most 100 rows), each with `version + 1`, a `field_changed` entry on
  `epicId` by the same actor, and a `task.updated` event.

### 5. Deleting and restoring

- `deleteTask` counts the task's live sub-tasks first: any is `409 has_subtasks`, with a
  detail naming how many (WT-09 decision 5).
- `restoreTask` of a sub-task whose parent is deleted clears `parent_task_id` and records a
  `field_changed` entry on `parentId` (to `null`). Its epic stays.

### 6. What a task answers

- `TaskSummary` gains `parent: { id, key, title } | null` (`TaskParent`, a schema id) and
  `subtasks: { done, total } | null` (`SubtaskProgress`): `null` for a task with no live
  sub-tasks; `done` counts those in a `done` column, so a backlog sub-task is not done.
  `taskSelect` joins the parent and adds the counts with a grouped subquery on
  `tasks_parent_idx`.
- `Task` gains `subtasks: TaskSummary[]`: the live sub-tasks, in board order (column
  position, then task position), then the backlog in rank order.
- Restricted agents need no new rule: a sub-task is in its parent's project, so whoever
  reads one may read the other.

### 7. Live updates

`task.updated` for a parent (its version unchanged) is also sent when one of its
sub-tasks is created, moved across column categories or to or from the backlog, deleted,
restored, attached or detached (question 2), so a board refreshes the parent's
`done/total`. Setting or clearing a parent sends `task.updated` for the sub-task, the old
parent and the new one (WT-09 decision 10).

### 8. History and the activity

`EDITABLE` gains `parentId`. The activity names a `parentId` value as `{ id, name }` with
the task's key as its name, `null` when the task is gone (WT-09 decision 9), through the
table map of WS-117. The timeline's sentence for it is item C's.

### 9. The filter

`taskFilterShape` gains `parentId`: `oneOrMany` of a task's id, a task key or `none`.
`taskFilterWhere` resolves keys to ids once; a task of another project, or an unknown one,
matches nothing, as an unknown account does (WS-116). `none` keeps tasks without a parent.

### 10. The contract

`createTaskContract` and `updateTaskContract` document `parentId`, the two `400`s and
`409 too_many_subtasks`; `deleteTaskContract` documents `409 has_subtasks`. Every task
list documents the `parentId` filter. `PROBLEM_CODES` gains `has_subtasks` and
`too_many_subtasks`. New fields and codes: not breaking (doc 0004 section 8).

## Files

| Path                                                                | Change                                               |
| ------------------------------------------------------------------- | ---------------------------------------------------- |
| `src/server/db/schema/tasks.ts`, migration `0024_task_parent`       | modify, create: section 2                            |
| `src/lib/schemas/tasks.ts`                                          | modify: `parentId`, `parent`, `subtasks`, the filter |
| `src/lib/schemas/problem.ts`                                        | modify: two codes                                    |
| `src/server/services/tasks.ts`                                      | modify: sections 3 to 7                              |
| `src/server/services/task-filter.ts`                                | modify: section 9                                    |
| `src/server/services/activity.ts`                                   | modify: `parentId` named                             |
| `src/server/services/subtasks.integration.test.ts`                  | create: tests 2 to 11                                |
| `src/server/db/schema/tasks.integration.test.ts`                    | create: test 1                                       |
| `src/server/services/task-filter.integration.test.ts`, `all-tasks…` | modify: test 12                                      |
| `src/server/services/activity.integration.test.ts`                  | modify: test 13                                      |
| `projects/[projectId]/tasks` and `tasks/[taskId]` route tests       | modify: test 14                                      |
| `src/lib/openapi/document.test.ts`                                  | modify: test 15                                      |
| `src/components/board/test-data.ts`, `mcp/src/testing.ts`           | modify: the two new summary fields                   |
| `docs/agents.md`                                                    | unchanged (item F)                                   |

## Data model changes

Migration `0024_task_parent`: `tasks.parent_task_id`, `tasks_parent_not_self_check`,
`tasks_parent_idx`.

## API contract

- `POST /api/v1/projects/{projectId}/tasks`, `PATCH /api/v1/tasks/{taskId}`: `parentId`
  (a task's id or key, or `null` on `PATCH`). `400` on `parentId` or `epicId`;
  `409 too_many_subtasks`. Permission unchanged (`tasks:write`).
- `DELETE /api/v1/tasks/{taskId}`: `409 has_subtasks`.
- `TaskSummary.parent`, `TaskSummary.subtasks`, `Task.subtasks`.
- Every task list: the `parentId` filter.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                       | Covers criterion |
| --- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | integration | the database refuses a task as its own parent, and a parent deleted while referenced (`restrict`)                                                          | 2                |
| 2   | integration | create and edit with `parentId` by id and by key; `null` clears it; the answer's `parent`                                                                  | 1, 4             |
| 3   | integration | each refusal of section 3, a `400` on `parentId`, with nothing written                                                                                     | 2                |
| 4   | integration | two concurrent writes that would chain three tasks: one passes, the other is a `400`                                                                       | 2                |
| 5   | integration | the epic is copied on attach, follows a parent's change (history and version on each sub-task), and a differing `epicId` is a `400`, an equal one accepted | 3                |
| 6   | integration | `subtasks` counts: none is `null`; done counts only `done` columns; backlog is not done; deleted ones are left out                                         | 4                |
| 7   | integration | `Task.subtasks` in board order, then the backlog                                                                                                           | 4                |
| 8   | integration | the 101st live sub-task is `409 too_many_subtasks`; a deleted one frees a place                                                                            | 5                |
| 9   | integration | deleting a parent is `409 has_subtasks`; after detaching or deleting its sub-tasks it deletes                                                              | 5                |
| 10  | integration | restoring a sub-task of a deleted parent clears the parent, with its history entry                                                                         | 5, 6             |
| 11  | integration | the events: attach, detach, a sub-task's move to `done` and its deletion each send `task.updated` for the parent                                           | 7                |
| 12  | integration | `parentId` filters the board list, the backlog and the list across projects, by id, key and `none`                                                         | 8                |
| 13  | integration | the activity names `parentId` values by key, `null` for a gone task                                                                                        | 6                |
| 14  | integration | the routes: `parentId` in the bodies, the `400`s name the field, the `409`s carry their codes                                                              | 1, 2, 5          |
| 15  | unit        | the OpenAPI document: `parentId`, `TaskParent`, `SubtaskProgress`, the codes, the filter                                                                   | 9                |

## Risks and open questions

Questions for the owner, each with a recommendation:

1. **An `epicId` equal to the parent's in a write to a sub-task.** WT-09 decision 2 says a
   sub-task's own `epicId` is a `400`; clients that send a whole task back would then fail
   on every edit of a sub-task. **Recommend: refuse only an `epicId` that differs from the
   parent's (section 4).**
2. **Events for a parent when its sub-tasks change.** Decision 10 names a parent change;
   a sub-task's move to `done` changes the parent's count too. **Recommend: `task.updated`
   for the parent on every write that changes its sub-tasks (section 7)**, so a board
   needs no rule of its own to know a parent's count moved.
3. **The `parentId` filter by key.** Lists name projects by id or key. **Recommend: the
   same for `parentId` (section 9).**

Risks:

- **Every task list now counts sub-tasks** per row. The count reads `tasks_parent_idx`;
  `scripts/measure-task-search.ts` is run again on the list across projects, and a
  slowdown past WS-118's numbers is raised with the owner.
- **`TaskSummary` gains two required fields**, so every fixture of it changes (the UI's
  and the MCP package's). New fields are not breaking for clients (doc 0004 section 8).
- **A migration beside item B's**: the second to merge regenerates its own, as section 1
  says.

## Implementation record

- Red (d08074d): 21 tests failed, on the missing column (`parent_task_id`), fields
  (`parent`, `subtasks`), codes and filter.
- Green (95751c1): migration `0024_task_parent`; `parentId`,
  `TaskParent`, `SubtaskProgress`, `subtaskList` and the filter in
  `src/lib/schemas/tasks.ts`; `has_subtasks` and `too_many_subtasks`; in
  `src/server/services/tasks.ts` the parent rules (`checkedParent`, rows locked in id
  order), the epic sync, the delete refusal, the restore that detaches, the parent's
  `task.updated` (`announceParents`); `parentOf` in `task-filter.ts`; parents named by key
  in `activity.ts`. Fixtures of `TaskSummary` and `Task` gained the new fields, and
  `docs/agents.md`'s filter list gained `parentId` (its doc check requires every filter).
- Gate on 2026-11-26:
  - typecheck, lint and Prettier pass; `pnpm db:generate` and `pnpm openapi:generate`
    leave no diff;
  - Vitest 2563 of 2563 (236 files); `project-events.test.tsx`'s reconnect test failed once
    in an earlier full run and passed alone and in this run (timing, not this change);
  - `pnpm test:e2e` 135 of 135;
  - Windows 11, pnpm 10.28.0, Compose PostgreSQL on port 5433.

## Deviations

1. **The list on a full task is `subtaskList`, not `subtasks`** (owner's decision on
   2026-11-26, during implementation). With `subtasks` the progress on every summary and the
   list on a full task, a full task stopped being a valid summary, which the web app relies
   on. `subtasks` is now `{ done, total } | null` on every task, full ones too.
2. **`docs/agents.md` names `parentId` among the filters now**, not in item F: the doc
   check of WS-131 requires every filter the API has.
3. **The two error codes are in doc 0004 section 4's table**, which its test requires;
   section 10 named only `PROBLEM_CODES`.
4. **The limit test has a 60-second timeout**: it makes 102 task writes, each its own
   transaction.
