# WS-141 — Tasks in sprints

- Status: Approved (approved by the owner on 2026-11-27, questions 1 to 4 as recommended)
- Work-item: [WI-141](../work-items/WI-141-tasks-in-sprints.md)
- Canonical docs: [0003](../canonical/0003-task-management.md) sections 3 ("put tasks
  into, or take them out of, a sprint or the backlog"), 4 (`Sprint`), 5 (board and
  backlog), 6 (sprints), 8 (the sprint filter), 9 (history) and 13 question 1;
  [0002](../canonical/0002-realtime-sync.md) section 3; [0004](../canonical/0004-api-conventions.md)
  sections 4 to 6; [WT-10](../work-tracks/WT-10-sprints-and-story-points.md) decisions 4,
  5, 8 to 11, 13 and 14, risk 1

## Approach

### 1. Starting point, checked against `main` (`7af0af6`)

- `sprints` exists (WI-140, migration `0026_sprints`) with `state` `planned` | `active` |
  `completed` and one active sprint per project; `projects.sprints_enabled` is answered as
  `sprintsEnabled`. Nothing starts or completes a sprint yet (item D), so an active or
  completed sprint exists only when a test writes one in the database.
- `tasks` has no sprint column; the last migration is `0027_task_story_points`.
- The paths that write a task's `column_id` (WT-10 risk 1), all in
  `src/server/services/`:
  1. `createTask` (`tasks.ts`): the first column by default, a given column, or the end of
     the backlog with `columnId: null`;
  2. `moveTask` (`tasks.ts`): a column or the backlog, with `afterTaskId` /
     `beforeTaskId`;
  3. `restoreTask` (`tasks.ts`): brings a task back where it was;
  4. `moveDeletedTasksOut` (`columns.ts`): moves deleted tasks out of a deleted column;
  5. `placeNewBug` and `fileBugReport` (`bug-reports.ts`): the top of the first column.
     `updateTask` does not write `column_id` today; `deleteTask` keeps it.
- `syncSubtaskEpics` (`tasks.ts`) is the model for a parent's field that its sub-tasks
  follow; `announceParents` tells a parent's page its progress moved.
- `listTasks` (the board list) answers live tasks with a column; `listBacklog` live tasks
  with none; `listAllTasks` everything, through `taskFilterWhere` (`task-filter.ts`).
- `deleteSprint` (`sprints.ts`) deletes a planned sprint; no task refers to it yet.
- The activity (`activity.ts`) names ids by `FIELD_KIND`; `scripts/agents-guide.test.ts`
  requires `docs/agents.md` to name every filter.

### 2. The data

Migration `0028_task_sprint`:

- `tasks.sprint_id uuid null references sprints(id) on delete restrict`;
- `tasks_sprint_idx` on `(sprint_id)` where `sprint_id is not null`, which the board list,
  the filter and the sprint writes read.

That a sprint is of the task's project is a service check, as for epics (WT-03), with an
integration test.

### 3. The rule, in one function

`src/server/services/sprint-placement.ts` holds the rule of WT-10 decision 5, so every path
of section 1 asks one place. `placeFor(tx, project, task, wanted)` takes what a write asks
for (a column, the backlog, a sprint, or nothing) and answers the task's `sprint_id`,
`column_id` and position after the write, or a refusal:

| The write asks for                          | Project with sprints                                                                          |
| ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| a column                                    | the active sprint, that column; `409 no_active_sprint` without one                            |
| the backlog                                 | no sprint (unscheduled), unless the move names a planned sprint (section 5)                   |
| `sprintId` = the active sprint              | its column if it has one, else the bottom of the first column                                 |
| `sprintId` = a planned sprint, or `null`    | no column: its backlog rank if it was there, else the end of the backlog                      |
| `sprintId` = a completed sprint             | `400` on `sprintId`: "Not a planned or active sprint."                                        |
| any change, on a task of a completed sprint | a move takes it out (as a column or backlog move above); `sprintId` is `409 sprint_completed` |

In a project without sprints, `placeFor` answers today's behaviour, with one addition
(question 3): a write that gives a task a column clears a planned sprint it kept from
before, with a history entry, so no task ever holds a column and a planned sprint.

The active sprint is read `for share`, so item D's start and completion, which will lock
it `for update`, run one at a time with these writes.

### 4. Creating a task

`sprintId` joins `createTaskFields` (a sprint's id, optional). In a project with sprints:

- `columnId` given: joins the active sprint, or `409 no_active_sprint`;
- `sprintId` given: placed by section 3; with a `columnId` too, the column must agree (an
  active sprint and a column, or a planned sprint and `null`), else `400` on `sprintId`;
- neither: the end of the backlog, unscheduled (WT-10 question 4). This changes the
  default for clients that create without a column: only in projects that turned sprints
  on, which none has yet.

`columnId`'s description says so. A non-null `sprintId` in a project without sprints is
`409 sprints_disabled`. The `created` history entry gains `sprintId` when set.

### 5. Moving a task

`moveTask` asks `placeFor` with the target column or the backlog. A column move of a task
not in the active sprint records a `field_changed` entry on `sprintId` beside its `moved`
entry. `MoveTaskRequest` gains `sprintId` (optional, only with `columnId: null`): a planned
sprint or `null`, so a drag between the backlog's sprint sections is one atomic write
(question 2); with a column it is a `400`.

### 6. Editing a task

`sprintId` joins `updateTaskFields` (`null` clears it) and `UPDATABLE`. `updateTask` asks
`placeFor`; when the column changes it records the `moved` entry, sends `task.moved`
rather than `task.updated`, and locks the target column as `moveTask` does. `EDITABLE`
gains `["sprintId", "sprint_id"]`.

### 7. Sub-tasks

As for the epic (WS-133 section 4):

- setting a parent copies its sprint; the sub-task is then placed by section 3 (into the
  first column when the parent is in the active sprint and the sub-task has no column; to
  the end of the backlog when the parent is not and the sub-task has a column);
- a `sprintId` that differs from the parent's in a write to a sub-task is a `400` on
  `sprintId`, "A sub-task's sprint is its parent's."; the same value is accepted;
- `syncSubtaskSprints`, beside `syncSubtaskEpics`, moves a parent's live sub-tasks with it
  when its sprint changes, each placed by section 3, with history entries and events;
- moving a sub-task to the backlog while its parent is in the active sprint, or onto the
  board while its parent is not, is `409 subtask_follows_parent`; within the active
  sprint a sub-task moves freely between columns.

Clearing a parent keeps the sub-task's sprint and column.

### 8. The other paths of section 1

- **Restore:** a restored task whose place breaks the rule (a column with no active or
  completed sprint, in a project with sprints) goes to the end of the backlog,
  unscheduled, with its `moved` and `field_changed` entries. Otherwise it comes back where
  it was, as today.
- **Deleting a column:** only deleted tasks move (`moveDeletedTasksOut`); they keep their
  sprint. Unchanged.
- **Deleting a planned sprint:** in the same transaction, its tasks, live and deleted,
  get `sprint_id = null`, each live one with a `field_changed` entry and `task.updated`.
  They already have no column, so their backlog rank stays.
- **Agent-filed bugs** (WT-10 decision 14, question 1): `placeNewBug` answers the top of
  the backlog, unscheduled, in a project with sprints, and the first column otherwise.

### 9. Reads

- `TaskSummary` gains `sprint: { id, name, state } | null` (`SprintRef`), joined in
  `taskSelect`.
- `listTasks` (not the deleted list) adds `and t.sprint_id = <the active sprint>` in a
  project with sprints, so it answers nothing when none is active.
- `listBacklog` is unchanged: planned-sprint tasks have no column, so they are in it, each
  with its `sprint`.
- `taskFilterShape` gains `sprintId`: one or many of a sprint's id, `none` (unscheduled)
  or `active` (each project's active sprint), resolved in `taskFilterWhere` as `epicId`
  is; an unknown or foreign sprint matches nothing.

### 10. History, events, codes

- The activity names a `sprintId` value as `{ id, name }` from `sprints`, `null` when gone
  (`FIELD_KIND`). The timeline's sentence is item F's.
- Events: `task.updated` for a sprint change, `task.moved` when the column changes too, and
  the parent's `task.updated` through `announceParents` when a sub-task moves. No new type.
- `PROBLEM_CODES` gains `no_active_sprint` and `subtask_follows_parent`; doc 0004 section 4
  names them. `sprints_disabled` and `sprint_completed` exist (WI-140).
- `docs/agents.md` names `sprintId` among the filters (its doc check requires it); the rest
  of the agents guide on sprints is item G.

## Files

| Path                                                                   | Change                                         |
| ---------------------------------------------------------------------- | ---------------------------------------------- |
| `src/server/db/schema/tasks.ts`, migration `0028_task_sprint`          | modify, create: section 2                      |
| `src/lib/schemas/tasks.ts`                                             | modify: `sprintId`, `sprint`, the move, filter |
| `src/lib/schemas/sprints.ts`                                           | modify: `SprintRef`                            |
| `src/lib/schemas/problem.ts`, `src/server/http/errors.ts`              | modify: two codes                              |
| `src/server/services/sprint-placement.ts`                              | create: section 3                              |
| `src/server/services/tasks.ts`                                         | modify: sections 4 to 9                        |
| `src/server/services/bug-reports.ts`                                   | modify: `placeNewBug`                          |
| `src/server/services/sprints.ts`                                       | modify: delete unschedules                     |
| `src/server/services/task-filter.ts`, `activity.ts`                    | modify: the filter, sprint names               |
| `src/server/services/sprint-placement.integration.test.ts`             | create: tests 2 to 10                          |
| `src/server/services/task-sprints.integration.test.ts`                 | create: tests 11 to 17                         |
| `src/server/db/schema/tasks.integration.test.ts`                       | modify: test 1                                 |
| `bug-reports`, `sprints`, `task-filter`, `all-tasks`, `activity` tests | modify: tests 18 to 21                         |
| task route tests, `src/lib/openapi/document.test.ts`                   | modify: tests 22 and 23                        |
| `docs/agents.md`, `docs/canonical/0004-api-conventions.md`             | modify: the filter, the codes                  |
| `src/components/board/test-data.ts`, `mcp/src/testing.ts`              | modify: `sprint: null`                         |

## Data model changes

Migration `0028_task_sprint`: `tasks.sprint_id`, `tasks_sprint_idx`.

## API contract

- `POST /api/v1/projects/{projectId}/tasks`, `PATCH /api/v1/tasks/{taskId}`: `sprintId`.
  `POST /api/v1/tasks/{taskId}/move`: `sprintId` with `columnId: null`. `400` on
  `sprintId`; `409 no_active_sprint`, `subtask_follows_parent`, `sprint_completed`,
  `sprints_disabled`. Permission unchanged (`tasks:write`).
- `TaskSummary.sprint` (`SprintRef`).
- Every task list: the `sprintId` filter.
- `GET /api/v1/projects/{projectId}/tasks`: in a project with sprints, the active sprint's
  tasks only. Projects without sprints: unchanged.

New fields, codes and a filter: not breaking (doc 0004 section 8). The board list's answer
changes only for projects that turn sprints on (WT-10 risk 3).

## Test plan (written first, in this order)

Every placement test runs in a project with sprints and, where the rule differs, in one
without.

| #   | Level       | Test                                                                                                                                | Covers criterion |
| --- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | integration | the database refuses a task's sprint deleted while referenced (`restrict`)                                                          | 1                |
| 2   | integration | create: with a column joins the active sprint; none active is `409 no_active_sprint`; without a column, the end of the backlog      | 3, 4             |
| 3   | integration | create with `sprintId`: active (first column), planned (backlog), completed or foreign (`400`), disagreeing with `columnId` (`400`) | 1, 4             |
| 4   | integration | move onto the board joins the active sprint (both entries); to the backlog leaves it; `sprintId` on a backlog move                  | 3                |
| 5   | integration | edit `sprintId`: to active (bottom of the first column, `task.moved`), to planned or `null` (end of the backlog, rank kept)         | 3                |
| 6   | integration | a completed sprint's task: `sprintId` is `409 sprint_completed`; a move takes it out of the record                                  | 6                |
| 7   | integration | sub-tasks: copied on attach and placed; follow the parent's change; differing `sprintId` `400`; both `409 subtask_follows_parent`   | 5                |
| 8   | integration | restore: a task whose place breaks the rule goes to the backlog; one that does not comes back where it was                          | 3                |
| 9   | integration | sprints off: a non-null `sprintId` is `409 sprints_disabled`; a column write clears a kept planned sprint                           | 8                |
| 10  | integration | two concurrent writes into the active sprint and a sprint row locked `for update`: the writes wait                                  | 3                |
| 11  | integration | the board list: only the active sprint's tasks; empty with none active; unchanged without sprints                                   | 2                |
| 12  | integration | the backlog lists planned-sprint and unscheduled tasks in one ranking, each with its `sprint`                                       | 2                |
| 13  | integration | every answer carries `sprint`; a foreign or unknown `sprintId` is a `400`                                                           | 1                |
| 14  | integration | history: `field_changed` on `sprintId` by the actor, with the `moved` entry when the column changes                                 | 10               |
| 15  | integration | events: `task.updated` for a sprint change, `task.moved` when the column changes, the parent's `task.updated`                       | 10               |
| 16  | integration | a Viewer and a `qa_agent` cannot set `sprintId` (`403`); a `worker_agent` can                                                       | 1                |
| 17  | integration | a restricted agent cannot give a task another project's sprint (`400`)                                                              | 1                |
| 18  | integration | deleting a planned sprint unschedules its tasks, with history and events                                                            | 7                |
| 19  | integration | an agent-filed bug: top of the backlog with sprints, top of the first column without                                                | 9                |
| 20  | integration | the `sprintId` filter on the board list, the backlog and across projects: an id, `none`, `active`                                   | 11               |
| 21  | integration | the activity names `sprintId` values by the sprint's name, `null` when gone                                                         | 10               |
| 22  | integration | the routes: `sprintId` in the three bodies, the `400` names the field, the `409`s carry their codes                                 | 1, 3, 5, 6, 8    |
| 23  | unit        | the OpenAPI document: `sprintId`, `SprintRef`, the move's field, the filter, the two codes                                          | 12               |

The existing board, backlog, move, restore and triage tests run unchanged in projects
without sprints: criterion 8's "unchanged" is that they still pass.

## Risks and open questions

Questions for the owner, each with a recommendation:

1. **Agent-filed bugs move from item D to this item.** WT-10 puts decision 14 in item D,
   but once this item lands a bug filed in a sprint project would get a column with no
   sprint, breaking decision 5. **Recommend: change `placeNewBug` here (section 8)** and
   record it as a deviation from WT-10's item table.
2. **`sprintId` on a backlog move.** A drag from one planned sprint's section to another
   changes both the sprint and the rank. **Recommend: one `POST /move` with `sprintId`
   (section 5)**, atomic and one event; the alternative is a `PATCH` and a move, two
   writes that a failure can leave half done.
3. **A kept planned sprint when sprints are off.** WT-10 decision 4 keeps planned sprints
   while sprints are off; moving one of their tasks onto the board would then give it a
   column and a planned sprint. **Recommend: that move clears the planned sprint, with a
   history entry (section 3)**; the alternative is leaving it for item D's "Sprint 1" to
   repair.
4. **Where a task leaving the active sprint goes in the backlog.** **Recommend: the end
   of the backlog** for `PATCH sprintId`, and where the move says for `POST /move`.

Risks:

- **Every path of section 1 changes**, so `placeFor` is tested in both kinds of project,
  and the existing tests of each path stay as they are.
- **Turning sprints on before item D merges** empties the board, since no sprint can be
  active yet. No UI turns them on until item E, and no release is tagged; item D comes
  next and makes "Sprint 1".
- **`TaskSummary` gains a required field**, so every fixture of it changes. New fields are
  not breaking for clients.
- **Lock order.** Writes take the project (shared), the target column, the active sprint
  (`for share`), then the task; item D must take them in the same order.
