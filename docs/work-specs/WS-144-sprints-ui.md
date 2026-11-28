# WS-144 — Sprints in the UI

- Status: Proposed
- Work-item: [WI-144](../work-items/WI-144-sprints-ui.md)
- Canonical docs: [0003](../canonical/0003-task-management.md) sections 3, 5 and 6;
  [0002](../canonical/0002-realtime-sync.md) sections 3 and 4;
  [WT-10](../work-tracks/WT-10-sprints-and-story-points.md) decisions 4 to 9 and 15,
  questions 3, 5, 6 and 9, risk 4; [WS-141](WS-141-tasks-in-sprints.md),
  [WS-142](WS-142-sprint-start-complete.md) and [WS-143](WS-143-sprint-fields-filter-mcp.md)
  with their deviations

## Approach

### 1. Starting point, checked against `main` (`9d007c9`)

- The API is complete (WI-139 to WI-142):
  - `PATCH /projects/{projectId}` takes `sprintsEnabled`. Turning sprints on with tasks on
    the board makes an active "Sprint 1", and turning them off with an active sprint is
    `409 sprint_active`.
  - The sprint endpoints are `GET` and `POST /projects/{projectId}/sprints`, then `GET`,
    `PATCH` and `DELETE /sprints/{sprintId}`. `POST /sprints/{sprintId}/start` takes
    `{ version }`, and `POST /sprints/{sprintId}/complete` takes
    `{ moveUnfinishedTo, version }` and answers `unfinishedSubtasksKept`.
  - `Sprint.progress` is `{ doneTasks, totalTasks, donePoints, totalPoints, unestimated }`,
    and is frozen once the sprint is completed.
  - `POST /tasks/{taskId}/move` takes `sprintId` with `columnId: null`, so one request
    moves a task between the backlog's sprints.
- The board list, in a project with sprints, answers only the active sprint's tasks. The
  backlog answers every task with no column, in one ranking, each task with its `sprint`.
- WI-143 added the following:
  - on the task page, the sprint field and the sentences for the four codes
    (`task-detail.tsx`);
  - `listOpenSprints` (`src/components/task/api.ts`);
  - the "Sprint" filter on the backlog and the list view;
  - a re-read of sprints on `sprint.changed`, on the task page only.
- The backlog (`backlog.tsx`, `use-backlog.ts`, `moves.ts`, `backlog-row.tsx`) is a single
  sortable list. It has drag and drop by pointer, touch and keyboard, "Move to board" on
  each row, the filter bar, and live updates. `sprint.changed` is a no-op there and on the
  board (WS-140 section 7).
- The board (`board.tsx`, `use-board.ts`, `board-column.tsx`, `card-menu.tsx`) uses
  sortable columns, with the "Move to" card menu of WI-111 and "Add task" per column. It
  turns failures into sentences with `failureMessage` in `use-board.ts`. The backlog has
  the same mapping.
- Project settings (`project-settings.tsx`) has five sections. The settings page requires
  `projects:manage`. The board and backlog pages pass `canWriteTasks` only.

### 2. Who sees what

The board and backlog pages also pass `canManageSprints` (`can(actor, "sprints:manage")`).

| Control                                          | Shown to                                                    |
| ------------------------------------------------ | ----------------------------------------------------------- |
| Settings' "Sprints" section                      | the settings page's readers, editable with `sprints:manage` |
| Create, edit, delete, start, complete a sprint   | `canManageSprints`, project not archived                    |
| Moving tasks between sections and onto the board | `canWriteTasks`, project not archived                       |
| Everything else in this spec                     | every reader                                                |

Nothing here shows in a project without sprints, except the settings section.

### 3. The settings' "Sprints" section

`src/components/projects/sprints-section.tsx`, after "Columns", contains:

- a switch "Use sprints" (`role="switch"`, named);
- a sentence that says what sprints do;
- a confirmation dialog for each change:
  - **On:** "Tasks on the board become 'Sprint 1', active from today for 14 days. You can
    rename it and change its dates in the backlog." When the board is empty, the sentence
    is "No sprint is created." The board's count comes from the first page of the board
    list.
  - **Off:** "Done tasks of completed sprints come back to the board, and planned sprints
    are kept for later." (WT-10 risk 4.) The answer `sprint_active` reads "Complete the
    active sprint first.", with a link to the board.

The change sends `PATCH` with `sprintsEnabled` and `version`. A `version_conflict` reads
the project again, as the details section does.

### 4. The backlog with sprints

In a project with sprints, the backlog page groups the one ranking it already loads into
sections, in this order:

1. **Active sprint**, a summary only: the name, the dates with "N days left" or "ended N
   days ago", the goal, a progress bar of done over total tasks named "3 of 8 tasks done",
   the points as "12 / 30 points" with "2 not estimated", and a link "Open the board". It
   lists no tasks, because they are on the board.
2. **One section per planned sprint**, by start date. The header shows the name, the
   dates, the goal (clamped to two lines, with "More"), the task count and the points.
   For a Manager it also shows "Start sprint" and a menu with "Edit" and "Delete". The
   section's tasks follow, in backlog order.
3. **Backlog**: the unscheduled tasks, with "Add task" for those who may.
4. **Completed sprints**: a collapsed disclosure, read with every page of them when it
   opens. Each one shows its name, its dates and its frozen progress, and links to
   `/tasks?projectId=<key>&sprintId=<id>` (WT-10 question 9).

A Manager also gets "Create sprint" above the planned sections.

The sections come from `task.sprint` and `listOpenSprints`. A planned sprint with no
tasks still shows, with "No tasks yet. Drag tasks here or use Move to." The filter bar
filters within each section, and a section with no matching tasks says "No matching
tasks".

Without sprints, the backlog stays exactly as today. The existing backlog tests run on a
project without sprints, unchanged.

### 5. Moving tasks in the backlog

- **Drag and drop:** the backlog becomes a sortable list of several containers, one per
  section, built like the board's columns. It uses the same sensors, measuring and keyboard
  coordinates, and the same announcements, which name the section ("OPA-12 is in Sprint 4,
  position 2 of 5."). A drop sends one `POST /move` with `columnId: null`, the target
  section's `sprintId` (`null` for the backlog) and the anchor next to it (WS-141 section
  5, deviation 1).
- **"Move to" menu:** each row gets a menu like the board's card menu (WI-111): "Move to
  top", "Move to bottom", one item per other planned sprint, "Backlog", and "Active
  sprint" while one is active. The last item replaces "Move to board" in a project with
  sprints.
- **Sub-tasks:** a sub-task's sprint is its parent's, so its menu offers only moves within
  its section, and a drag into another section is refused before any request, with "A
  sub-task stays in its parent's sprint." The server's `400` and `409` remain the guard.
- **Optimistic update:** each move is applied at once and rolled back on failure, as
  today.

### 6. Creating, editing, deleting and starting

- **Sprint dialog** (`sprint-dialog.tsx`), for create and edit. It has a name, a goal (a
  textarea) and two date inputs, with each field's `400` under it.
  - The defaults for a new sprint are the name "Sprint N", where N is one more than the
    number of the project's sprints, and dates from the day after the latest sprint's end
    (or today) for 14 days (question 3).
  - Editing works for planned and active sprints and sends `version`. A conflict reads the
    sprint again and says so.
- **Delete:** a confirmation dialog: "Delete Sprint 4? Its 6 tasks go back to the
  backlog, unscheduled." It is offered only for planned sprints.
- **Start:** a confirmation dialog: "Start Sprint 4? Its 6 tasks go to the first column,
  To do." The answer `sprint_active` reads "Complete the active sprint first." and
  `sprint_not_planned` reads "This sprint has already started." On success the page says
  "Sprint 4 started." and offers a link to the board.

### 7. The board with sprints

- **Header** (`sprint-header.tsx`), above the filter bar. It shows the active sprint's
  name, its dates with days left, its goal, the progress bar and points of section 4, and
  "Complete sprint" for a Manager.
- **No active sprint:** the board shows "No sprint is active." and a link "Plan and start a
  sprint in the backlog" in place of the columns (question 1). Nothing can be added or
  moved there, so no request can meet `no_active_sprint`.
- **"Add task"** in a column adds the task to the active sprint, as the API does (WS-141
  section 4). The message says "OPA-40 was added to Sprint 4, To do."
- **The card menu's "Move to backlog"** reads "Move out of the sprint" in a project with
  sprints.
- **Filter bar:** the "Sprint" filter stays off the board (WS-143 question 1).

### 8. Completing

`complete-sprint-dialog.tsx`:

- It counts, from the board it holds:
  - the done tasks, which stay as the sprint's record;
  - the unfinished tasks that leave;
  - the unfinished sub-tasks that stay with a done parent ("2 unfinished sub-tasks stay
    with their done parent, as part of the record."). The families are the same as in
    WS-142 section 5.
- A select chooses where the unfinished work goes. The default is the next planned sprint
  by start date, else "Backlog (unscheduled)" (question 4). It also offers "New sprint…",
  which opens the sprint dialog first and then selects the new sprint.
- It sends `POST /sprints/{sprintId}/complete`. The answer says "Sprint 4 completed: 8 done,
  3 moved to Sprint 5." and uses `unfinishedSubtasksKept` from the answer. A
  `sprint_not_active` reads "This sprint is no longer active." and reloads the page.

### 9. Live updates and sentences

- **`sprint.changed`:** the backlog reads the open sprints again. The board reloads the
  sprint header, and reloads the whole board when the active sprint changed (a start or a
  completion), because which tasks belong on it changed. The settings section reads the
  project again on `project.changed`, as the details section does.
- **Sentences:** `failureMessage` on the board and on the backlog gains the four sentences
  of WS-143 section 3, shared from one module (`src/components/sprints/messages.ts`) that
  the task page also uses.

### 10. Accessibility

- Every section is a `section` with its heading.
- Each progress bar is a `progressbar`, named in words.
- Dialogs keep and return focus as the project settings dialogs do (WI-129).
- The switch, the menus and the disclosure are keyboard-operable.
- The pages' axe checks cover the new states: a backlog with sprints, a board with a
  header, and a board with no active sprint.

## Files

| Path                                                                                  | Change                           |
| ------------------------------------------------------------------------------------- | -------------------------------- |
| `src/components/projects/sprints-section.tsx`, `project-settings.tsx`                 | create, modify: section 3        |
| `src/components/sprints/sprint-dialog.tsx`, `start-sprint-dialog.tsx`                 | create: section 6                |
| `src/components/sprints/complete-sprint-dialog.tsx`, `sprint-header.tsx`              | create: sections 7 and 8         |
| `src/components/sprints/sprint-progress.tsx`, `messages.ts`, `api.ts`                 | create: shared parts             |
| `src/components/backlog/backlog.tsx`, `use-backlog.ts`, `moves.ts`, `backlog-row.tsx` | modify: sections 4 and 5         |
| `src/components/board/board.tsx`, `use-board.ts`, `card-menu.tsx`                     | modify: sections 7 and 9         |
| `src/components/task/task-detail.tsx`                                                 | modify: use the shared sentences |
| `src/app/(app)/projects/[projectKey]/page.tsx`, `backlog/page.tsx`                    | modify: `canManageSprints`       |
| tests beside each component (`*.test.tsx`)                                            | create, modify: tests 1 to 13    |
| `tests/e2e/sprints-ui.spec.ts`                                                        | create: tests 14 and 15          |

## Data model changes

None.

## API contract

None: the UI uses the endpoints of WI-139 to WI-142.

## Test plan (written first, in this order)

| #   | Level | Test                                                                                                                                                                           | Covers criterion |
| --- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| 1   | unit  | the settings section: the switch, both notices, the `PATCH`, `sprint_active`'s sentence; read-only without `sprints:manage`                                                    | 1                |
| 2   | unit  | the backlog with sprints: the active summary, planned sections by start date, the unscheduled tasks, completed sprints on opening, the links                                   | 2                |
| 3   | unit  | the backlog without sprints renders as today (its existing tests unchanged)                                                                                                    | 2                |
| 4   | unit  | moves: a drop in another section sends one move with `sprintId` and the anchor; "Move to" items; a sub-task's drag refused before a request                                    | 4                |
| 5   | unit  | keyboard moves between sections, with the announcements naming the section                                                                                                     | 4, 10            |
| 6   | unit  | the sprint dialog: defaults, each field's `400`, create and edit, a conflict                                                                                                   | 3                |
| 7   | unit  | delete and start dialogs: their sentences, the requests, `sprint_active` and `sprint_not_planned`                                                                              | 3, 5             |
| 8   | unit  | the board's header: name, dates, days left, goal, progress named in words; "Complete sprint" only for a Manager                                                                | 6                |
| 9   | unit  | the board with no active sprint: the empty state and its link, no columns                                                                                                      | 6                |
| 10  | unit  | the complete dialog: the three counts, the families, the default target, "New sprint…", the request, the answer's sentence                                                     | 7                |
| 11  | unit  | the four sentences on the board and the backlog, from one module                                                                                                               | 8                |
| 12  | unit  | live: `sprint.changed` reloads the backlog's sprints and the board's header; a start or completion reloads the board                                                           | 9                |
| 13  | unit  | a Viewer sees every section and header and no control that writes                                                                                                              | 2, 6, 10         |
| 14  | e2e   | a Manager turns sprints on (Sprint 1 appears), plans Sprint 2, a Member drags tasks into it, the Manager completes Sprint 1 into Sprint 2 and starts it; a second page follows | 1 to 7, 9        |
| 15  | e2e   | the axe checks of the backlog with sprints, the board with a header, and the board with no active sprint                                                                       | 10               |

## Risks and open questions

Questions for the owner, each with a recommendation:

1. **The board with no active sprint.** **Recommend: an empty state linking to the backlog,
   with no columns (section 7)**, so no add or move can meet `no_active_sprint`. The
   alternative is empty columns that refuse every drop.
2. **One work-item or two.** This item touches the backlog, the board and the settings.
   **Recommend: one**, because the backlog's start and the board's completion are one
   flow, and test 14 needs both. The alternative is splitting the board (sections 7 and 8)
   into its own work-item, to run in parallel.
3. **A new sprint's defaults.** **Recommend: "Sprint N", starting the day after the latest
   sprint ends (or today), for 14 days (section 6).** Teams change them in the dialog.
4. **Where "Complete sprint" sends unfinished work by default.** **Recommend: the next
   planned sprint, else the backlog (section 8).**

Risks:

- **The backlog's drag and drop becomes multi-container.** It reuses the board's sensors,
  collision and measuring code (WS-098, WS-111) instead of new ones. Tests 4 and 5 and the
  existing backlog tests guard it.
- **A start or completion moves many tasks at once.** The board reloads once on
  `sprint.changed` rather than applying hundreds of `task.moved` events. It already loads
  the whole board when too many events are held (WS-049).
- **The pages grow.** The new parts are components in `src/components/sprints/`, so
  `backlog.tsx` and `board.tsx` only compose them.
