# WS-139 — Story points

- Status: Proposed
- Work-item: [WI-139](../work-items/WI-139-story-points.md)
- Canonical docs: [0003](../canonical/0003-task-management.md) sections 3 ("set …
  points"), 4 (`Story points`, epic progress) and 9 (history);
  [0004](../canonical/0004-api-conventions.md) sections 5 and 6;
  [WT-10](../work-tracks/WT-10-sprints-and-story-points.md) decisions 1, 2, 13 and 15,
  questions 1 and 2

## Approach

### 1. Starting point, checked against `main` (`5834e80`)

- `tasks` (`src/server/db/schema/tasks.ts`) has no points column; the last migration is
  `0025_task_links_types`.
- `taskFields` (`src/lib/schemas/tasks.ts`) builds `TaskSummary`, `Task` and
  `TaskListItem`; `createTaskFields`, `updateTaskFields` and `UPDATABLE` hold the writable
  fields. `TASK_SORTS` lists the list view's orders.
- `createTask` and `updateTask` (`src/server/services/tasks.ts`) write the fields;
  `EDITABLE` records one `field_changed` entry per changed field; `taskSelect` and
  `toSummary` read them; `SORT_KEYS` defines each order, with `dueDate` as the model of a
  key whose empty values come last both ways.
- Epic progress (`EPIC_SELECT`, `src/server/services/epics.ts`) counts live tasks and
  those in a `done` column; `epicSchema.progress` is `{ doneTasks, totalTasks }`.
- The UI shows the fields in `details-section.tsx` (read rows and the edit form),
  `task-card.tsx`, `task-list-table.tsx` (`COLUMNS`), `activity-text.tsx`
  (`FIELD_NAMES`, values) and `epic-progress.tsx`.
- `scripts/agents-guide.test.ts` requires `docs/agents.md` to name every sort of
  `TASK_SORTS`, so this item adds `storyPoints` there.
- Item B (WI-140) adds a migration in parallel: whichever merges second deletes its own and
  runs `pnpm db:generate` again (`AGENTS.md` section 8).

### 2. The data

Migration `0026_task_story_points`:

- `tasks.story_points numeric(4,1) null`;
- `tasks_story_points_check`: `story_points is null or (story_points between 0 and 999.5
and story_points * 2 = trunc(story_points * 2))`.

No index: nothing filters by points, and the sort reads them only after the filters
(section 5).

`numeric` comes back from the driver as a string, so `taskSelect` reads
`t.story_points::float8 as story_points`; every value it holds is exact in a `float8`.

### 3. The field

`storyPointsSchema = z.number().min(0).max(999.5).multipleOf(0.5)` (WT-10 question 1),
with a description naming the range and the step:

- `createTaskFields.storyPoints`: optional; by default none;
- `updateTaskFields.storyPoints`: optional, `nullable` (clears them); `UPDATABLE` gains it;
- `taskFields.storyPoints`: `number | null`, so `TaskSummary`, `Task` and `TaskListItem`
  carry it.

`createTask` inserts it; `updateTask` writes it and `EDITABLE` gains
`["storyPoints", "story_points"]`, so a change is one `field_changed` entry with the old
and new numbers. A sub-task has points of its own (WT-10 decision 1). Permission
unchanged: `tasks:write`.

### 4. Epic totals

`EPIC_SELECT` gains three sums over the same live tasks it counts today:

- `total_points`: `coalesce(sum(story_points), 0)`;
- `done_points`: the same over tasks in a `done` column;
- `unestimated`: the count of tasks with no points.

`epicSchema.progress` gains `donePoints` and `totalPoints` (numbers, multiples of 0.5) and
`unestimated` (an integer). Sub-tasks count as stored (WT-10 decision 2, question 2). The
two existing counts become one subquery with `filter` clauses, so the epic still reads its
tasks once.

### 5. The sort

`TASK_SORTS` gains `storyPoints`. `SORT_KEYS.storyPoints` follows `dueDate`: a first key
`(t.story_points is null)`, always ascending, so tasks with none come last both ways, then
`coalesce(t.story_points, 0)` read and written in cursors as text, its cursor value checked
by `/^\d{1,3}(\.\d)?$/`. The `sort` description gains it.

### 6. The UI

- **Task page** (`details-section.tsx`): a "Story points" row after "Due date", "None" when
  empty; the edit form gains a number input (`min 0`, `max 999.5`, `step 0.5`), empty
  meaning `null`, with the field's error from a `400` shown as the others are.
- **Card** (`task-card.tsx`): when the task has points, a small badge with the number,
  `aria-label` "3 story points" ("1 story point" for 1), after the due date (question 1).
- **List view** (`task-list-table.tsx`): a "Points" column, sortable by `storyPoints`,
  empty when none, after "Due".
- **Timeline** (`activity-text.tsx`): `storyPoints` is named "story points"; a value is the
  number, `null` "none".
- **Epics** (`epic-progress.tsx`): the bar stays on tasks; beside it, text "5 / 13 points"
  with `aria-label` "5 of 13 story points done", and "2 not estimated" when `unestimated`
  is above 0. An epic whose tasks have no points shows no points text.

The new-task dialog gains nothing, as it has no priority or due date either (question 2).

### 7. Live updates

None new: a points change sends `task.updated` as any edit does, and the epics page
already refetches an epic on its tasks' events.

### 8. Agents and the MCP server

`docs/agents.md` gains a "Story points" paragraph beside priority and due date (the range,
the step, `null`, `tasks:write`) and `storyPoints` among the sorts. The MCP tools take the
field through `createTaskFields` and `updateTaskFields`; `opanel_search_tasks`'s
description lists the new sort. `mcp/src/testing.ts` and `src/components/board/test-data.ts`
gain `storyPoints: null`.

## Files

| Path                                                                      | Change                                           |
| ------------------------------------------------------------------------- | ------------------------------------------------ |
| `src/server/db/schema/tasks.ts`, migration `0026_task_story_points`       | modify, create: section 2                        |
| `src/lib/schemas/tasks.ts`                                                | modify: the field, `UPDATABLE`, `TASK_SORTS`     |
| `src/lib/schemas/epics.ts`                                                | modify: `progress` gains three fields            |
| `src/server/services/tasks.ts`                                            | modify: select, create, update, `EDITABLE`, sort |
| `src/server/services/epics.ts`                                            | modify: section 4                                |
| `src/server/services/task-story-points.integration.test.ts`               | create: tests 1 to 5                             |
| `src/server/services/epics.integration.test.ts`                           | modify: test 6                                   |
| `src/server/services/all-tasks.integration.test.ts`                       | modify: test 7                                   |
| `src/app/api/v1/projects/[projectId]/tasks`, `tasks/[taskId]` route tests | modify: test 8                                   |
| `src/lib/openapi/document.test.ts`                                        | modify: test 9                                   |
| `src/components/task/details-section.tsx`, `task-detail.test.tsx`         | modify: test 10                                  |
| `src/components/board/task-card.tsx`, `task-card.test.tsx`                | modify: test 11                                  |
| `src/components/task-list/task-list-table.tsx` and its test               | modify: test 12                                  |
| `src/components/task/activity-text.tsx`, `activity-text.test.tsx`         | modify: test 13                                  |
| `src/components/epics/epic-progress.tsx` and a test beside it             | modify, create: test 14                          |
| `tests/e2e/story-points.spec.ts`                                          | create: test 15                                  |
| `docs/agents.md`, `mcp/src/tools/search.ts`                               | modify: section 8                                |
| `src/components/board/test-data.ts`, `mcp/src/testing.ts`, epic fixtures  | modify: the new fields                           |

## Data model changes

Migration `0026_task_story_points`: `tasks.story_points numeric(4,1)`,
`tasks_story_points_check`.

## API contract

- `POST /api/v1/projects/{projectId}/tasks`: `storyPoints` (optional).
  `PATCH /api/v1/tasks/{taskId}`: `storyPoints` (`null` clears). `400` on `storyPoints`.
  Permission unchanged (`tasks:write`).
- `TaskSummary.storyPoints`, so `Task` and `TaskListItem` too.
- `GET /api/v1/tasks`: `sort` accepts `storyPoints` and `-storyPoints`.
- `Epic.progress`: `donePoints`, `totalPoints`, `unestimated`.

New fields and a new sort value: not breaking (doc 0004 section 8).

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                  | Covers criterion |
| --- | ----------- | --------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | integration | the database refuses -0.5, 1000, 1.25 and accepts 0, 0.5, 999.5                                                       | 1                |
| 2   | integration | create with `storyPoints`, edit it, clear it with `null`; every answer carries it as a number                         | 1, 2             |
| 3   | integration | each invalid value is a `400` on `storyPoints`, with nothing written                                                  | 1                |
| 4   | integration | a change is one `field_changed` entry on `storyPoints` with both numbers, by the actor; the activity answers it       | 3                |
| 5   | integration | a Viewer and a `qa_agent` get `403`; a `worker_agent` sets them                                                       | 7                |
| 6   | integration | epic progress: points summed, done only in `done` columns, sub-tasks counted, deleted left out, `unestimated` counted | 5                |
| 7   | integration | `sort=storyPoints` and `-storyPoints` page through tasks with a cursor, tasks with none last both ways                | 4                |
| 8   | integration | the routes: `storyPoints` in both bodies, the `400` names the field                                                   | 1                |
| 9   | unit        | the OpenAPI document: `storyPoints` on the requests and `TaskSummary`, the sort, the epic progress fields             | 8                |
| 10  | unit        | the task page shows "Story points" and sends a number, `null` when emptied; a Viewer sees no editor                   | 6, 7             |
| 11  | unit        | a card shows "3" named "3 story points", "1 story point" for 1, and nothing without points                            | 6                |
| 12  | unit        | the list view's "Points" column shows them and sorts by `storyPoints`                                                 | 4                |
| 13  | unit        | the timeline reads a points change, and a cleared one as "none"                                                       | 3                |
| 14  | unit        | an epic shows "5 / 13 points" named in words, "2 not estimated", and nothing for an epic with no points               | 6                |
| 15  | e2e         | a Member sets points on a task page, sees them on its card and in the epic, and reads the change in the timeline      | 3, 6             |

`scripts/agents-guide.test.ts` and its existing check of `TASK_SORTS` cover criterion 8's
guide part with no new test.

## Risks and open questions

Questions for the owner, each with a recommendation:

1. **Points on a card.** Every card gains a badge when the task has points. **Recommend:
   show the number only when set (section 6)**; the alternative is showing them only on
   the task page and in the list view.
2. **Points in the new-task dialog.** It has no priority or due date today. **Recommend:
   not added**; points are set on the task page or through the API. The alternative is
   adding the three fields together, as their own work-item.
3. **The sort's empty values.** **Recommend: tasks with no points last both ways**, as
   with due dates (section 5).

Risks:

- **`numeric` comes back as a string** from the driver; a missed cast would answer
  `"3.0"`. Test 2 checks the answer's type, and `TaskSummary`'s strict schema refuses a
  string in the route tests.
- **`TaskSummary` and `Epic.progress` gain required fields**, so every fixture of them
  changes (the UI's and the MCP package's). New fields are not breaking for clients.
- **A migration beside item B's**: the second to merge regenerates its own, as section 1
  says.
