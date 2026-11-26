# WS-135 — Sub-tasks in the UI

- Status: Approved (approved by the owner on 2026-11-26, questions 1 to 3 as recommended)
- Work-item: [WI-135](../work-items/WI-135-subtasks-ui.md)
- Canonical docs: [0003](../canonical/0003-task-management.md) section 7 (sub-tasks);
  [0002](../canonical/0002-realtime-sync.md) section 3 (`task.updated`);
  [WT-09](../work-tracks/WT-09-subtasks-and-links.md) decisions 2, 4, 5, 10 and 12;
  [WS-133](WS-133-subtasks-api.md) (the API: `parentId`, `parent`, `subtasks`,
  `subtaskList`, the parent's events)

## Approach

### 1. Starting point, checked against `main` (`35aa542`)

- The API (WI-133): `parentId` on create and `PATCH`; every task has `parent` and
  `subtasks: { done, total } | null`, a full task `subtaskList`; `400` on `parentId` or
  `epicId`, `409 has_subtasks` on delete, `409 too_many_subtasks`. A write that changes a
  parent's sub-tasks sends `task.updated` for the parent **with its version unchanged**.
- `TaskDetail` (`src/components/task/task-detail.tsx`) loads the task, columns, activity,
  teams, epics and labels, and follows the project stream: `task.updated` and `task.moved`
  for its own task are read only when their version is newer (`isNewer`). Its sections are
  `DetailsSection` (a form with "Save changes", and "Move to" apart), `BugSection` (which
  shows links today; item D moves them) and `ActivitySection`.
- `useBoard` and `useBacklog` refresh a card only for a newer version, so the parent's
  event of WS-133 section 7 changes nothing on them today.
- `CardBody` (`board/task-card.tsx`) and `BacklogRow` show a task's key, title, type and
  the rest; neither knows `parent` or `subtasks`.
- `NewTaskDialog` (`board/new-task-dialog.tsx`) creates a task in a given column or the
  backlog. `listTaskItems` (`task-list/api.ts`, WI-130) reads `GET /tasks` with filters.
- The timeline's sentences are in `activity-text.tsx`; `parentId` has none, so it shows the
  raw field.

### 2. The "Sub-tasks" section

`SubtasksSection` (`src/components/task/subtasks-section.tsx`), a `region` named
"Sub-tasks", after the details:

- shown on a task that is not a sub-task; left out for someone who cannot edit tasks when
  the task has no sub-tasks;
- the heading's line says "2 of 5 done" (`task.subtasks`), or "No sub-tasks yet.";
- a list of `task.subtaskList` in its order: the key as a link to the task, the title, the
  status (the column's name from the loaded columns, or "Backlog") and the assignee;
- "Add sub-task" (people who edit, project not archived) opens `NewTaskDialog` with a new
  `parent` prop, in the project's first column (question 2). On success the page reads the
  task again, so the list and the count come from the API.

### 3. "Parent" in the details

In `DetailsSection`, a "Parent" row outside the form, since it saves at once as "Move to"
does (question 1):

- **A sub-task:** "Sub-task of" and a link to the parent's key and title; "Remove parent"
  sends `PATCH { parentId: null, version }`.
- **A task with sub-tasks:** "Has sub-tasks; it cannot be a sub-task."
- **Any other task, for people who edit:** "Set parent" opens a small dialog with a search
  box that reads `listTaskItems` with `projectId` = the project, `parentId=none`, and `q`
  (300 ms after typing stops, as the filter bar does), leaving out the task itself.
  `parentId=none` already leaves out sub-tasks; any other refusal comes back as the API's
  `400`, which the dialog shows. Choosing a result sends `PATCH { parentId, version }`.
- Every one of these goes through `saved`, `conflict` and `failed` like the other writes,
  so a stale version shows the other person's change first.

The form's **Epic** select is disabled on a sub-task, with "Follows its parent." beside it
(WT-09 decision 2), and the form never sends `epicId` for a sub-task.

### 4. Marks on cards and rows

- `CardBody` gains, in its meta line: on a sub-task, a `CornerDownRightIcon` and the
  parent's key, with the accessible text "Sub-task of OPA-1"; on a parent, a
  `ListChecksIcon` and `2/5`, with the accessible name "2 of 5 sub-tasks done".
- `BacklogRow` shows the same two marks.
- The list view gains nothing (WT-09 decision 12).

### 5. Following changes

- **Board and backlog:** a `task.updated` whose version equals the held card's is read as
  "its sub-tasks changed": the hook fetches the task and takes only its `subtasks` into the
  card, one fetch at a time per task as `refreshTask` does. A newer version is handled as
  today.
- **The task page:** the same equal-version event for its own task reads the task again and
  takes `subtasks` and `subtaskList` only, so unsaved edits are not touched. A `task.*`
  event for a task in `subtaskList` reads the task again the same way, so a sub-task's
  rename or reassignment shows in the list.
- **A sub-task's page:** when its parent changes elsewhere, its own `task.updated` (a new
  version) is read as today.

### 6. Messages and the timeline

- `failed()` gains `has_subtasks`: "Delete or detach its sub-tasks first." and
  `too_many_subtasks`: "That task already has 100 sub-tasks."; a `400` on `parentId` or
  `epicId` shows the API's message under the control that sent it.
- `activity-text.tsx` says "made it a sub-task of OPA-1" (no old value), "removed it from
  OPA-1" (no new value), and "moved it from OPA-1 to OPA-4"; a `null` name says "a deleted
  task" as other fields do.

## Files

| Path                                                         | Change                                                |
| ------------------------------------------------------------ | ----------------------------------------------------- |
| `src/components/task/subtasks-section.tsx`, its test         | create: section 2                                     |
| `src/components/task/parent-field.tsx`, its test             | create: section 3, "Parent" and "Set parent"          |
| `src/components/task/details-section.tsx`                    | modify: the "Parent" row, the epic of a sub-task      |
| `src/components/task/task-detail.tsx`, its test              | modify: the sections, section 5, section 6's messages |
| `src/components/task/activity-text.tsx`, its test            | modify: section 6's sentences                         |
| `src/components/board/new-task-dialog.tsx`                   | modify: an optional `parent`                          |
| `src/components/board/task-card.tsx`, `board-card` tests     | modify: section 4                                     |
| `src/components/backlog/backlog-row.tsx`, `backlog.test.tsx` | modify: section 4                                     |
| `src/components/board/use-board.ts`, its test                | modify: section 5                                     |
| `src/components/backlog/use-backlog.ts`, its test            | modify: section 5                                     |
| `tests/e2e/subtasks.spec.ts`                                 | create: tests 10 and 11                               |
| `tests/e2e/accessibility.spec.ts`                            | modify: test 12                                       |

## Data model changes

None.

## API contract

None: the UI uses the API of WI-133.

## Test plan (written first, in this order)

| #   | Level | Test                                                                                                                                       | Covers criterion |
| --- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| 1   | unit  | the section: rows in the API's order with status and assignee, "2 of 5 done", hidden on a sub-task and for a Viewer with none              | 1                |
| 2   | unit  | "Add sub-task" opens the dialog in the first column with the parent; the created sub-task is read into the list                            | 2                |
| 3   | unit  | "Parent": the link on a sub-task, "Remove parent" sends `parentId: null` with the version; a parent says it cannot be a sub-task           | 3                |
| 4   | unit  | "Set parent" searches with `projectId`, `parentId=none` and `q`, leaves the task out, and sends the chosen id; a `400` shows its message   | 3, 6             |
| 5   | unit  | the epic select is disabled on a sub-task, and its save sends no `epicId`                                                                  | 3                |
| 6   | unit  | the card and the backlog row show the parent's key and `2/5`, with their accessible names                                                  | 4                |
| 7   | unit  | the board and the backlog take a parent's progress from an equal-version `task.updated`; a newer version is handled as before              | 5                |
| 8   | unit  | the task page takes `subtasks` and `subtaskList` from an equal-version event without touching the form, and re-reads on a sub-task's event | 5                |
| 9   | unit  | the timeline's three sentences; deleting a parent says to delete or detach its sub-tasks                                                   | 6, 7             |
| 10  | e2e   | a Member adds two sub-tasks from a page, sees `0/2` on the board, moves one to Done there, and the open parent page shows "1 of 2 done"    | 1, 2, 4, 5       |
| 11  | e2e   | a Member sets a parent from a task's page by searching, sees the sub-task's card mark, removes the parent, and reads both in the timeline  | 3, 7             |
| 12  | e2e   | the accessibility checks of a parent's page, a sub-task's page and a board with both, in light and dark mode                               | 8                |

## Risks and open questions

Questions for the owner, each with a recommendation:

1. **How "Parent" saves.** Inside the details form it would wait for "Save changes" with
   the other fields; apart, it saves at once, as "Move to" does. **Recommend: apart, at
   once (section 3)**, since a parent change also changes the epic and is its own
   history entry.
2. **Where "Add sub-task" puts the new task.** **Recommend: the project's first column,**
   as the API does by default and as "Add task" on the board does; the alternative is the
   backlog.
3. **Equal-version events.** WS-133 sends the parent's `task.updated` with its version
   unchanged. **Recommend: read it as "the sub-tasks changed" and take only `subtasks`
   (and `subtaskList` on the page), section 5**, rather than changing the API to bump the
   parent's version, which would make every sub-task write a conflict for someone editing
   the parent.

Risks:

- **Three hooks learn the equal-version rule** (board, backlog, page). Each gets its own
  test (7, 8), and the rule only ever replaces `subtasks`/`subtaskList`, never a field a
  person may be editing.
- **The search dialog** is a second searchable picker beside the label picker. It reuses
  `listTaskItems` and the filter bar's 300 ms wait, so it adds no new pattern.
- **Item D (links in the UI)** also changes `task-detail.tsx` and moves the links out of
  `BugSection`: whichever merges second rebases on the first.
