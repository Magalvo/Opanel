# WS-142 — Starting and completing sprints

- Status: Done (approved by the owner on 2026-11-27, questions 1 to 4 as recommended; done on
  2026-11-28)
- Work-item: [WI-142](../work-items/WI-142-sprint-start-complete.md)
- Canonical docs: [0003](../canonical/0003-task-management.md) sections 3 ("create, start,
  complete sprints; enable sprints on a project"), 6 (sprints) and 9 (history);
  [0002](../canonical/0002-realtime-sync.md) section 3 (`sprint.changed`, task events);
  [0004](../canonical/0004-api-conventions.md) sections 4 to 6;
  [WT-10](../work-tracks/WT-10-sprints-and-story-points.md) decisions 2, 6 to 9, 11 and
  12, risk 2; [WS-141](WS-141-tasks-in-sprints.md) (the placement rule, its lock order and
  deviation 4)

## Approach

### 1. Starting point, checked against `main` (`7c2c9ef`)

- `sprints` (WI-140) already holds `started_at`, `completed_at`, `total_points` and
  `completed_points`, with checks tying them to the state (`sprints_started_check`,
  `sprints_completed_check`) and one active sprint per project. Nothing writes them; tests
  set a sprint `active` or `completed` in the database.
- `tasks.sprint_id` and the placement rule are in (WI-141): `placeFor`,
  `lockSprintContext` (reads the active sprint `for share`), `lockFirstColumn`,
  `recordPlaceChange` and `unscheduleSprintTasks` in `src/server/services/sprint-placement.ts`.
  Its comment fixes the lock order: the project, the columns, the active sprint, the task;
  start and completion lock the sprint `for update`.
- A sub-task is off the board exactly when its parent is, even when the parent's sprint is
  completed (WS-141 deviation 4, accepted by the owner).
- `updateProject` (`projects.ts`) turns `sprintsEnabled` on and off and refuses turning it
  off with an active sprint; it changes nothing else.
- Epic progress sums points with `coalesce(sum(story_points), 0)`, a `filter` on `done`
  columns, and a count of tasks with none (WS-139); `Sprint` has no progress yet.
- `AUDIT_ACTIONS` holds `sprint.created`, `sprint.updated`, `sprint.deleted`.
- The last migration is `0028_task_sprint`.

### 2. The data

Migration `0029_sprint_frozen_progress`: `sprints.total_tasks`, `sprints.completed_tasks`
and `sprints.unestimated` (`int`, null), and `sprints_completed_check` extended so all
five frozen values are set exactly when the state is `completed` (question 2). The
existing check is dropped and created again, in the migration, not edited.

### 3. Progress on every sprint

`Sprint` gains `progress`: `{ doneTasks, totalTasks, donePoints, totalPoints,
unestimated }`, the shape of `Epic.progress`. For a planned or active sprint it is computed
over its live tasks, sub-tasks included, done meaning in a `done` column (WT-10 decision
2), with the sums of WS-139. For a completed sprint it is the five frozen values, so it
says what was planned and what was done, whatever happens to the tasks afterwards.

### 4. Starting

`POST /sprints/{sprintId}/start` with `{ version }`, needing `sprints:manage`. In one
transaction:

1. Lock the project row exclusively (tasks leave the backlog, whose order it guards,
   WS-101), then the first column, then the sprint `for update`.
2. Refuse: the project does not use sprints (`409 sprints_disabled`); the sprint is not
   `planned` (`409 sprint_not_planned`); another sprint is `active` (`409 sprint_active`);
   a stale version (`409 version_conflict` with the sprint as it is).
3. Lock the sprint's live tasks `for update`, in backlog order, and place each at the
   bottom of the first column in that order, through `placeFor`'s active-sprint branch,
   so the rule stays in one place. Each gets a new version, a `moved` entry named after the
   Manager, and `task.moved`.
4. Set `state = 'active'`, `started_at = now()`, `version + 1`; write `sprint.started`
   (`{ projectId, name, tasks }`); send `sprint.changed`.

Its deleted tasks keep no column: a restore places them by WS-141's rule (deviation 7).
Dates are not changed: they are informational (WT-10 question 7), and the sprint's
`PATCH` edits them before or after.

### 5. Completing

`POST /sprints/{sprintId}/complete` with `{ moveUnfinishedTo: <uuid> | null, version }`,
needing `sprints:manage`. In one transaction:

1. Lock the project row exclusively, then the sprint and, when named, the target sprint,
   `for update` in id order.
2. Refuse: the project does not use sprints (`409 sprints_disabled`); the sprint is not
   `active` (`409 sprint_not_active`, a new code); `moveUnfinishedTo` is not a `planned`
   sprint of the project (`400` on `moveUnfinishedTo`); a stale version.
3. Freeze the progress of section 3 into the five columns, before anything moves.
4. Sort the sprint's live tasks into **families**: a task with no parent in this sprint,
   with its sub-tasks. A family is done when its head is in a `done` column (question 1).
   - A done family stays: every member keeps its column and the sprint, as the record,
     unfinished sub-tasks included (WS-141 deviation 4 keeps them with their parent).
   - Every other family leaves: each member loses its column and goes to the target sprint
     or unscheduled, at the **top** of the backlog, the families in board order (column
     position, then task position), each head before its sub-tasks. Each member gets a
     `moved` entry and a `field_changed` entry on `sprintId`, named after the Manager, and
     `task.moved`; parents get `task.updated` through `announceParents`.
5. Its deleted tasks follow the same split, without entries or events, so a restore finds a
   consistent place.
6. Set `state = 'completed'`, `completed_at = now()`, `version + 1`; write
   `sprint.completed` (`{ projectId, name, moveUnfinishedTo, moved }`); send
   `sprint.changed` for it and, when named, for the target sprint, whose tasks changed.

The answer is the completed `Sprint`, with its frozen progress and, beside it,
`unfinishedSubtasksKept`: how many unfinished sub-tasks stayed in the record with a done
parent, so item E's dialog can say so before and after (question 1).

### 6. "Sprint 1" when sprints are turned on

In `updateProject`, when `sprintsEnabled` goes from `false` to `true`, in the same
transaction, which holds the project row:

1. Count the live tasks that have a column and no active or completed sprint. With none,
   nothing else happens.
2. Otherwise insert "Sprint 1": `state = 'active'`, `start_date = current_date`,
   `end_date = current_date + 14`, `started_at = now()`, `created_by` the Manager
   (question 3).
3. Give it each of those tasks: `sprint_id` only, as they keep their column; a
   `field_changed` entry on `sprintId` named after the Manager, a new version and
   `task.updated` each.
4. Write `sprint.created` and `sprint.started` for it; send `sprint.changed`.

So the board lists the same tasks the moment after (WT-10 decision 6). A task with a
column and a completed sprint, kept from an earlier time with sprints, stays in that
record.

### 7. Audit, codes and events

- `AUDIT_ACTIONS` gains `sprint.started` and `sprint.completed`.
- `PROBLEM_CODES` gains `sprint_not_active`; doc 0004 section 4 names it.
- No new event type; `sprint.changed` and the task events of doc 0002 section 3.

### 8. Size

A sprint has no size limit (WT-10 risk 2). Test 14 starts and completes a 500-task sprint
and records the time in the implementation record; past 2 seconds on the reference machine,
this item stops and proposes a limit to the owner.

## Files

| Path                                                                       | Change                                   |
| -------------------------------------------------------------------------- | ---------------------------------------- |
| `src/server/db/schema/sprints.ts`, migration `0029_sprint_frozen_progress` | modify, create: section 2                |
| `src/lib/schemas/sprints.ts`                                               | modify: `progress`, the two requests     |
| `src/lib/schemas/audit.ts`, `problem.ts`, `src/server/http/errors.ts`      | modify: section 7                        |
| `src/server/services/sprints.ts`                                           | modify: sections 3 to 5                  |
| `src/server/services/projects.ts`                                          | modify: section 6                        |
| `src/server/services/sprint-placement.ts`                                  | modify: the start and completion helpers |
| `src/app/api/v1/sprints/[sprintId]/start/route.ts`, `complete/route.ts`    | create                                   |
| `src/server/db/schema/sprints.integration.test.ts`                         | modify: test 1                           |
| `src/server/services/sprint-start-complete.integration.test.ts`            | create: tests 2 to 11, 14                |
| `src/server/services/projects.integration.test.ts`                         | modify: tests 12 and 13                  |
| the two route tests, `viewer-writes.integration.test.ts`                   | create, modify: test 15                  |
| `src/lib/openapi/document.test.ts`                                         | modify: test 16                          |
| `docs/canonical/0004-api-conventions.md`                                   | modify: the code                         |
| sprint fixtures (UI and `mcp/src/testing.ts`)                              | modify: `progress`                       |

## Data model changes

Migration `0029_sprint_frozen_progress`: `sprints.total_tasks`, `completed_tasks`,
`unestimated`; `sprints_completed_check` dropped and created again with them.

## API contract

| Method and path                            | Permission       | Answers                                                                                                         |
| ------------------------------------------ | ---------------- | --------------------------------------------------------------------------------------------------------------- |
| `POST /api/v1/sprints/{sprintId}/start`    | `sprints:manage` | `Sprint`; `409 sprint_active`, `sprint_not_planned`, `sprints_disabled`, `version_conflict`                     |
| `POST /api/v1/sprints/{sprintId}/complete` | `sprints:manage` | `CompletedSprint`; `400` on `moveUnfinishedTo`; `409 sprint_not_active`, `sprints_disabled`, `version_conflict` |
| `PATCH /api/v1/projects/{projectId}`       | by field         | unchanged; turning sprints on may create "Sprint 1"                                                             |

`Sprint.progress` (`SprintProgress`); `CompletedSprint` is `Sprint` with
`unfinishedSubtasksKept`. New endpoints, fields and a code: not breaking (doc 0004
section 8).

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                  | Covers criterion |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | integration | the database refuses a completed sprint without all five frozen values, and frozen values on a sprint that is not completed           | 6                |
| 2   | integration | start: the tasks reach the bottom of the first column in backlog order, with `moved` entries, events, `startedAt`, the audit entry    | 1, 8             |
| 3   | integration | start refusals: another active, not planned, sprints off, stale version; nothing written                                              | 2                |
| 4   | integration | start of an empty sprint; a deleted task of the sprint keeps no column and is placed by the rule when restored                        | 1                |
| 5   | integration | complete to a planned sprint: done tasks stay with their column; the others reach the top of the backlog in board order, in it        | 3, 8             |
| 6   | integration | complete to `null`: the unfinished are unscheduled, at the top of the backlog, in board order                                         | 3                |
| 7   | integration | families: a done parent keeps its unfinished sub-task (counted in `unfinishedSubtasksKept`); an unfinished parent takes its done ones | 4                |
| 8   | integration | complete refusals: not active, a target that is completed, active, of another project or unknown; sprints off; stale version          | 5                |
| 9   | integration | progress: planned and active computed live, sub-tasks counted; completed frozen and unchanged after its tasks move or change points   | 6                |
| 10  | integration | the events: `task.moved` per moved task, `sprint.changed` for the completed sprint and the target                                     | 3, 8             |
| 11  | integration | a Member, a Viewer and a `worker_agent` get `403` on start and complete                                                               | 9                |
| 12  | integration | turning sprints on with tasks on the board: "Sprint 1" active, today to +14, exactly those tasks, history; the board list unchanged   | 7, 8             |
| 13  | integration | turning sprints on with an empty board, or with only completed-sprint tasks on it, creates no sprint                                  | 7                |
| 14  | integration | a 500-task sprint starts and completes; the time is recorded                                                                          | 1, 3             |
| 15  | integration | the routes: bodies read, each code, `CompletedSprint`; both writes in the Viewer-writes list                                          | 2, 5, 9          |
| 16  | unit        | the OpenAPI document: both operations, `SprintProgress`, `CompletedSprint`, `sprint_not_active`                                       | 10               |

## Risks and open questions

Questions for the owner, each with a recommendation:

1. **A done parent with an unfinished sub-task at completion.** WT-10 decision 7 sends
   unfinished work out of the sprint, decision 9 keeps a sub-task with its parent, and
   WS-141 deviation 4 keeps a sub-task off the board exactly when its parent is.
   **Recommend: families (section 5).** A done parent keeps its sub-tasks in the record,
   finished or not, and the answer counts the unfinished ones it kept, for item E's dialog
   to show. An unfinished parent takes all its sub-tasks out, done ones too. The
   alternative is to count a parent as unfinished while any sub-task is, which moves a
   finished parent out of the sprint it was finished in.
2. **Freezing task counts too.** WT-10 decision 7 freezes points only, but a completed
   sprint's live task counts would then shrink as its unfinished work leaves, beside
   points that do not. **Recommend: freeze all five values (migration
   `0029_sprint_frozen_progress`)**; the alternative is a completed sprint answering only
   its frozen points.
3. **"Today" for "Sprint 1".** **Recommend: the database's `current_date`** (UTC on the
   Compose and production images) for 14 days; the Manager edits the dates afterwards.
4. **Where unfinished work lands.** WT-10 decision 7 says the top of the backlog for
   unscheduled work. **Recommend: the top for both targets, in board order**, so the next
   sprint's carried-over work leads it.

Risks:

- **Start and completion touch every task of a sprint** in one transaction, with an entry
  and an event each; section 8 measures it.
- **Lock order.** Both take the project, then the columns or sprints, then the tasks, the
  order WS-141 fixed; test 3 and test 8 run beside a task write to the same sprint.
- **`Sprint` gains a required field**, so its fixtures change. New fields are not breaking
  for clients.
- **"Sprint 1" changes `PATCH /projects/{id}`'s side effects** for a project turned on with
  tasks on its board; `project.updated`'s audit entry and the sprint's own entries record
  both.

## Implementation record

- Red (a261021, 86f494b): tests 1 to 16 written first; 27 tests and 2 route files failed, on
  the missing columns (`total_tasks`), functions (`startSprint`, `completeSprint`), routes,
  `progress` and the OpenAPI document.
- Green (a6f0d80): migration `0029_sprint_frozen_progress` (it drops and creates again
  `sprints_completed_check`); `SprintProgress`, `CompletedSprint`, `StartSprintRequest`,
  `CompleteSprintRequest` and both contracts in `src/lib/schemas/sprints.ts`;
  `sprint_not_active`, `sprint.started` and `sprint.completed`; `progress` on every sprint
  (live, or frozen once completed) and `startSprint` and `completeSprint` in
  `src/server/services/sprints.ts`; `placeStartedSprintTasks`, `placeCompletedSprintTasks`
  and `startFirstSprint` in `src/server/services/sprint-placement.ts`, called from
  `updateProject` when sprints are turned on; the two routes; doc 0004's table.
- Test 14 (500 tasks, half done, completed into a planned sprint), three runs: start 213 to
  231 ms, complete 174 to 180 ms, well under the 2 seconds of section 8. A first version that
  wrote each task with its own statements took 8.3 s and 4.4 s; the writes are now one
  statement each for the places, the history and the events (deviation 1).
- Gate on 2026-11-28:
  - typecheck, lint and Prettier pass; `pnpm db:generate` and `pnpm openapi:generate`
    leave no diff;
  - Vitest 2847 of 2847 (250 files);
  - `pnpm test:e2e` 146 of 146;
  - Windows 11, Node 24.18.0, pnpm 10.28.0, Compose PostgreSQL 18.7 on port 5433.

## Deviations

1. **The rule is asked once per kind of place, and the writes are batched.** Section 4 put
   each started task through `placeFor`'s active-sprint branch; it now places the first one
   (the bottom of the first column) and the others follow it in backlog order with
   `positionsBetween`. Completion asks `placeFor` once for a head and once for a sub-task
   following it, as every leaving family goes to the same place. The places, the history
   entries and the events of all tasks are then written in one statement each
   (`writePlaces`, `recordPlaceChanges`; `recordPlaceChange` now calls the latter), which
   took test 14 from 8.3 s and 4.4 s to about 0.2 s each.
2. **`placeFor` no longer keeps a task of an active sprint that has no column** when the
   write names its own sprint: it joins the board as a task joining the active sprint
   would. Only a just-started sprint's tasks are in that place; before, the short cut
   "same sprint, keep the place" answered it.
3. **Two WS-141 tests changed with "Sprint 1"**: `all-tasks.integration.test.ts` (test 20)
   turned sprints on with tasks on the board and then made another sprint active; it now
   uses each project's "Sprint 1", and its `sprintId` expectations follow. The activity test
   (WS-141 test 21) moves its task to the backlog first, so no "Sprint 1" is made. The
   fixtures that set a sprint completed in the database set the three new frozen values,
   `sprints.integration.test.ts` expects `progress`, and the access test of WS-073 lists the
   two services and classifies the three new helpers as internal.
4. **Doc 0004's rows for `sprint_active` and `sprint_not_planned` also name starting**, as
   both codes now answer it.
5. **Deleted tasks of a leaving family keep their version**: section 5 gives them no entries
   or events; they only lose the column and take the target sprint, with a place at the top
   of the backlog when they had a column.
6. **The target sprint's `sprint.changed` carries its version unchanged**: its row is not
   written, only its tasks change (as `announceParents` does for a parent).
7. **Test 14 inserts its 500 tasks in SQL and has a 60-second timeout**, so only start and
   completion are timed. The new check of migration 0029 refuses a completed sprint without
   the three new values; no sprint could be completed before this item outside tests.
