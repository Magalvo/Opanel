# WT-10 — Sprints and story points

- Status: Draft
- Canonical docs: [0003](../canonical/0003-task-management.md) (section 3: "put tasks into,
  or take them out of, a sprint or the backlog", "create, start, complete sprints; enable
  sprints on a project", "set … points"; section 4: the `Story points` and `Sprint` fields,
  epic progress in points; section 5: the board and the backlog; section 6: sprints;
  section 8: the sprint filter; section 13 question 1: agent-filed bugs in sprint
  projects), [0001](../canonical/0001-ai-qa-agents-and-triage.md) (section 3: agent scopes;
  section 6 and doc 0003 section 12: where a new bug goes),
  [0002](../canonical/0002-realtime-sync.md) (section 3: the event contract),
  [0004](../canonical/0004-api-conventions.md) (sections 5 and 6: lists, writes),
  [0005](../canonical/0005-mcp-server.md) (section 4: the tools)

## Goal

A team that works in sprints turns them on for its project, plans sprints in the backlog,
starts one, works it on the board, and completes it, choosing where unfinished work goes.
Any task can carry story points, and every sprint and epic shows its total and done points.
Projects that do not use sprints keep the board and backlog they have today, and agents
read and plan sprints work through the same API.

## Depends on

- **WT-03** (board core): projects, columns and their categories, epics and their progress.
- **WT-04** (live sync): the project event stream.
- **WT-05** (agents): scopes and project restrictions.
- **WT-06** (triage): `placeNewBug`, which this track changes for sprint projects.
- **WT-07** (backlog): tasks with no column, the backlog's ranking and endpoint.
- **WT-08** (filters, list view, timeline): the filter set, which gains `sprintId`.
- **WT-09** (sub-tasks): which left "sub-tasks and sprints" to this track.

## Starting point

Checked on 2026-11-27 against `main` (`4da0784`):

- No sprint exists anywhere: no table, column, schema, endpoint or page. The permission
  catalogue already holds `sprints:manage`, given to Managers and Admins and to no agent
  scope; nothing checks it.
- **Story points do not exist either.** Doc 0003 section 4 lists them ("optional
  non-negative number"), but `tasks` has no column for them and no schema, answer or page
  shows them. Epic progress counts tasks only (`doneTasks`, `totalTasks`).
- The board list (`GET /projects/{projectId}/tasks`) answers every live task that has a
  column; the backlog (`GET /projects/{projectId}/backlog`) every live task that has none,
  in one ranking per project (`tasks_backlog_position_idx`).
- A new task goes to the first column unless `columnId: null` sends it to the end of the
  backlog. `POST /tasks/{taskId}/move` takes a column or `null` for the backlog.
- `placeNewBug` (`src/server/services/bug-reports.ts`) puts a new agent-filed bug at the top
  of the first column; its comment says WT-10 changes only this function (the follow-up in
  `docs/README.md`).
- `PATCH /projects/{projectId}` takes a name and a description; the project answer has no
  settings.
- Live events: `task.*`, `column.changed`, `epic.changed`, `label.changed`,
  `project.changed` (doc 0002 section 3). Epics, columns and labels write the audit log
  (`epic.created`, …); tasks write their history.
- WT-08 left the sprint filter to this track (doc 0003 section 8); WT-09 left "how
  sub-tasks enter a sprint".
- There is no tagged release: v1 may still gain fields and endpoints (doc 0004 section 8).

## In scope

- Story points on every task: stored, written by people and agents with `tasks:write`,
  answered, shown on cards and the task page, in the history; points in epic progress.
- Sprints as a per-project setting, off by default, turned on and off by a Manager.
- Sprints: create, edit, delete (planned only), start, complete; their total and done
  points; the record a completed sprint keeps.
- Tasks in sprints: the `sprintId` field on create and edit, how a move onto or off the
  board changes it, what the board and the backlog list in a sprint project, sub-tasks
  following their parent.
- Agent-filed bugs at the top of the backlog in sprint projects (doc 0003 section 13).
- The `sprintId` filter on every task list, history entries, live events, the audit log.
- The UI: the project setting, the backlog's sprint sections, the board's sprint header,
  the start and complete dialogs, the task page fields, the filter bar.
- `docs/agents.md` and its doc check, the MCP tool to list sprints, the canonical
  amendments of proposals P1 to P4.

## Out of scope

- Burndown, velocity and any other report or chart (doc 0003 sections 6 and 11).
- More than one active sprint per project, or sprints shared between projects.
- Scheduled starts or ends: a sprint starts and completes only when a Manager says so; its
  dates are informational.
- An estimation scale or unit setting (hours, T-shirt sizes): points are a plain number.
- Sprint management by agents: no agent scope gains `sprints:manage` (doc 0001 section 3).
- A page of its own for a completed sprint beyond the list view filtered by it (question 9).

## Design decisions

Choices the canonical docs leave open. Each is detailed in the work-spec of the item that
implements it.

1. **Story points are a column.** `tasks.story_points`, `numeric(5,1)`, nullable, checked
   between 0 and 999.5 in steps of 0.5 (question 1). `storyPoints: number | null` on
   create, `PATCH` and every task answer (`TaskSummary` too, for cards). A change is a
   `field_changed` entry with field `storyPoints`. A sub-task has points of its own.
2. **Totals count what is stored.** A total is the sum of the points of the live tasks
   concerned, sub-tasks included; a task with no points counts as 0 and is counted apart
   (`unestimated`), so "12 points, 3 tasks not estimated" can be shown. Done means in a
   `done` column, as everywhere (doc 0003 section 5). Epic progress gains `donePoints`,
   `totalPoints` and `unestimated`.
3. **Sprints are a table.** `sprints` (`id`, `project_id`, `name` 1 to 100, `goal` up to
   2 000, `start_date`, `end_date` not before it, `state` `planned` | `active` |
   `completed`, `completed_points`, `total_points` frozen on completion, `version`,
   `created_by`, timestamps), with a partial unique index allowing one `active` sprint per
   project. Dates are required on create (doc 0003 section 6 gives every sprint both) and
   order the planned sprints: by start date, then creation. `tasks.sprint_id`, nullable,
   with an index.
4. **The setting.** `projects.sprints_enabled`, default `false`, answered as
   `sprintsEnabled` and written by `PATCH /projects/{projectId}` with `sprints:manage`.
   Turning it off while a sprint is active is `409 sprint_active` (doc 0003 section 6).
   While it is off, a task's `sprintId` must be `null` (`409 sprints_disabled`); planned
   sprints and their tasks are kept and come back when it is turned on again.
5. **The rule that ties a column to a sprint.** In a sprint project, a live task has a
   column exactly when its sprint is `active` or `completed`. Everything else follows:
   - the board list answers the tasks of the active sprint only, and nothing when no
     sprint is active; the backlog answers the tasks with no column, planned-sprint tasks
     included, each with its `sprint`, in the one ranking it has today;
   - moving a task into a column adds it to the active sprint (`409 no_active_sprint` when
     there is none); moving it to the backlog takes it out of the active sprint;
   - setting `sprintId` to the active sprint puts the task at the bottom of the first
     column; setting it to a planned sprint or `null` puts it in the backlog, keeping its
     rank when it was already there;
   - creating a task: `columnId` given joins the active sprint as a move would; with no
     `columnId`, a task goes to the end of the backlog, unscheduled (question 4).
     Projects without sprints keep today's behaviour exactly.
6. **Turning sprints on with tasks on the board** creates an active sprint named "Sprint 1",
   from today to 14 days later, holding every live task that has a column, so the board
   looks the same the moment after (question 3). One history entry per task, named after
   the Manager.
7. **Starting and completing.** `POST /sprints/{sprintId}/start`: a planned sprint, when
   no other is active (`409 sprint_active`); its tasks go to the first column in their
   backlog order. `POST /sprints/{sprintId}/complete` with
   `{ moveUnfinishedTo: <planned sprint id> | null, version }`: tasks in a `done` column
   stay attached and keep their column, as the sprint's record; the others leave their
   column and go to that planned sprint, or unscheduled to the top of the backlog, keeping
   their order. The sprint's `totalPoints` and `completedPoints` are frozen at that moment,
   so a record still says what was planned. Both are allowed on any day.
8. **The rest of a sprint's life.** `POST /projects/{projectId}/sprints`,
   `GET /projects/{projectId}/sprints` (paged; `state` filter; planned and active first),
   `GET /sprints/{sprintId}`, `PATCH /sprints/{sprintId}` (name, goal, dates; any state
   but `completed`), `DELETE /sprints/{sprintId}` (planned only: its tasks become
   unscheduled; `409 sprint_not_planned` otherwise). A sprint's answer carries its
   points: `totalPoints`, `donePoints`, `unestimated`, and `taskCount`. A completed
   sprint's tasks cannot be given another sprint (`409 sprint_completed`); moving one into
   a column or the backlog takes it out of the record, as reopening work should.
9. **Sub-tasks follow their parent's sprint**, as they follow its epic (WT-09 decision 2):
   `sprint_id` is copied when a parent is set and kept in step when the parent's sprint
   changes, with a history entry each; a sub-task's own `sprintId` in a write is a `400`.
   A sub-task's column stays its own: in the active sprint it moves freely between
   columns, and moving it to the backlog is a `409 subtask_follows_parent` while its parent
   is in the active sprint.
10. **Who may do what.** `sprints:manage` (Managers, Admins): the setting, and creating,
    editing, deleting, starting and completing sprints. `tasks:write` (Members, worker
    agents): a task's `sprintId` and story points, and the moves of decision 5. Reading
    sprints needs `tasks:read`; a restricted agent reads only its projects' sprints.
11. **History and audit.** A task's sprint change is a `field_changed` entry with field
    `sprintId`, its values named as epics are (`{ id, name }`); a start or completion that
    moves a task also writes its `moved` entry, named after the Manager. Sprint and setting
    changes write the audit log: `sprint.created`, `sprint.updated`, `sprint.deleted`,
    `sprint.started`, `sprint.completed`, and `project.updated` for the setting.
12. **Live updates.** One new event type, `sprint.changed` (entity `sprint`, the sprint's
    answer after the write, `null` when deleted), on the project stream (proposal P3). A
    start, completion or setting change sends it and a `task.updated` or `task.moved` per
    task, in one transaction, as doc 0002 section 4 asks; the board and backlog refetch
    their lists on `sprint.changed`.
13. **Filters.** `sprintId` joins the task filters of WT-08 decision 1: a sprint's id,
    `none` for unscheduled tasks, or `active` for the project's active sprint. Story points
    join the list view's sorts as `storyPoints`.
14. **New agent-filed bugs** in a sprint project go to the top of the backlog, unscheduled
    (doc 0003 section 13). Only `placeNewBug` changes, as WI-094 promised.
15. **The UI.** Project settings gain "Use sprints" (with the decision 6 notice when the
    board has tasks). In a sprint project, the backlog page shows the active sprint's
    summary, then one section per planned sprint (name, dates, goal, points, "Start
    sprint", the edit menu), then the unscheduled tasks, with "Create sprint"; tasks drag
    between sections as they reorder today, with the keyboard moves of WI-111. The board
    shows the active sprint's name, goal, dates and points above the columns, with
    "Complete sprint" opening the dialog of decision 7, or an empty state linking to the
    backlog. The task page gains "Story points" and, in sprint projects, "Sprint"; a card
    shows its points; the filter bar gains a sprint filter; epics show points progress.
16. **Agents** read sprints, set `sprintId` and points, and filter by sprint with the
    scopes they have: `docs/agents.md` gains sprints and points, its doc check covers them,
    and the MCP server gains `opanel_list_sprints` (question 8). `sprintId` and
    `storyPoints` reach the existing task tools on their own, as `parentId` did in WT-09.

## Proposed canonical changes

Not edited until approved, then applied by item G.

- **P1 — doc 0003 section 4, `Story points`:** "Optional, 0 to 999.5 in steps of 0.5.
  Totals count sub-tasks too; a task with none counts as 0 and is shown as not estimated."
  (decisions 1 and 2)
- **P2 — doc 0003 section 6, rules:** add: "In a project with sprints, a task has a column
  only while its sprint is active or completed: moving a task onto the board adds it to the
  active sprint, moving it to the backlog takes it out. A new task goes to the backlog
  unless it is created in a column. Turning sprints on with tasks on the board makes them
  an active 'Sprint 1'. Completing a sprint freezes its points. A planned sprint can be
  deleted; its tasks return to the backlog. Sub-tasks follow their parent's sprint."
  (decisions 5 to 9)
- **P3 — doc 0002 section 3:** add the row `sprint.changed` | `sprint` | the sprint's after
  the write; `null` when deleted | creating, editing, deleting, starting, completing a
  sprint, or turning sprints on. (decision 12)
- **P4 — doc 0005 section 4:** add `opanel_list_sprints` | `GET /projects/{id}/sprints` |
  `tasks:read`. (decision 16, question 8)

## Work-items (outline)

Letters until each item starts; each gets its number on `main` when it starts, with its
work-spec.

| Item | Title                                                                                                          | Depends on |
| ---- | -------------------------------------------------------------------------------------------------------------- | ---------- |
| A    | Story points: the column, the field on writes and answers, history, the sort, epic points progress, card, page | none       |
| B    | Sprints in the API: the table, the project setting, create, read, edit, delete, audit, `sprint.changed`        | none       |
| C    | Tasks in sprints: `sprint_id`, decision 5's rules on create, edit and move, the board list, sub-tasks, filter  | B          |
| D    | Starting and completing a sprint, "Sprint 1" on turning sprints on, frozen points, agent-filed bugs            | A, C       |
| E    | Sprints in the UI: the setting, the backlog's sections, the board header, the start and complete dialogs       | D          |
| F    | The task page's "Sprint", the sprint filter in the filter bar and list view, `opanel_list_sprints`             | C          |
| G    | End-to-end flow, `docs/agents.md`, proposals P1 to P4, exit check                                              | E, F       |

A touches the tasks schema and the epic service; B adds a table and touches projects. They
share the migration sequence only, so the second to merge regenerates its migration
(`AGENTS.md` section 8); they can run in parallel. C is the heart of the track and the
riskiest item: its work-spec lists every path that writes `column_id` and how decision 5
applies to each.

## Exit criteria

- [ ] A Member sets, changes and clears a task's story points; a value outside decision 1
      is a `400` on `storyPoints`; the history names who did it; an epic shows done and
      total points.
- [ ] A Manager turns sprints on and off; turning them off with an active sprint is
      `409 sprint_active`; turning them on with tasks on the board makes "Sprint 1" with
      every one of them, and the board shows the same tasks.
- [ ] A Manager creates, edits, deletes, starts and completes sprints; each refusal of
      decisions 7 and 8 answers its code; a completed sprint keeps its done tasks and its
      frozen points.
- [ ] In a sprint project the board lists only the active sprint's tasks; moving a task
      onto the board and back changes its sprint, and the history shows both; in a project
      without sprints nothing changes (the existing board and backlog tests pass as they
      are).
- [ ] A sub-task follows its parent into and out of a sprint; its own `sprintId` is a `400`.
- [ ] An agent-filed bug in a sprint project lands at the top of the backlog, unscheduled;
      in a project without sprints, at the top of the first column, as today.
- [ ] A `worker_agent` sets `sprintId` and points and filters by `sprintId=active`; it
      cannot create, start or complete a sprint (`403`); a restricted agent sees no other
      project's sprints.
- [ ] A Viewer reads everything this track adds and writes nothing; every new endpoint
      enforces its permission.
- [ ] A page open on the board or the backlog follows another person's start, completion
      and sprint change with no reload.
- [ ] `docs/agents.md` and its doc check cover sprints and points; the OpenAPI document
      describes them; docs 0002, 0003 and 0005 carry the approved proposals.
- [ ] The full quality gate passes on `main`, with `pnpm db:generate` and
      `pnpm openapi:generate` leaving no diff.

## Risks and open questions

Questions for the owner, each with a recommendation:

1. **What a story point can be.** Doc 0003 says "non-negative number". **Recommend: 0 to
   999.5 in steps of 0.5** (covers the usual 0.5, 1, 2, 3, 5, 8 … scales); the
   alternatives are whole numbers only, or any decimal.
2. **Sub-tasks in totals.** Counting them risks counting work twice when a team estimates
   both the parent and its sub-tasks. **Recommend: count every task as stored (decision 2)** and let the team choose where it estimates; the alternative is leaving sub-tasks
   out of totals, as Jira does.
3. **Turning sprints on with a full board.** **Recommend: the board's tasks become an
   active "Sprint 1" (decision 6)**, so nothing disappears; the alternatives are refusing
   while the board has tasks, or sending them all to the backlog.
4. **Where a new task goes in a sprint project.** **Recommend: the backlog, unscheduled,
   unless a column is given (decision 5)**, so the team decides what enters a running
   sprint, as doc 0003 already decided for agent-filed bugs. The alternative is today's
   first column, which would add every new task to the active sprint. The board's "Add
   task" sends the first column, so a person adding a card on the board still sees it
   there.
5. **The column a task keeps.** Decision 5 clears the column of a task leaving the active
   sprint, so unfinished work carried into the next sprint starts again in the first
   column. **Recommend: accept it** (the history keeps where it was); keeping columns on
   tasks outside the active sprint would make the board and backlog rules much harder to
   state.
6. **Reopening a completed sprint's task.** **Recommend: moving it takes it out of the
   record (decision 8)**, and the frozen points keep what the sprint achieved; the
   alternative is refusing to move it.
7. **Sprint dates.** **Recommend: required, informational, and not checked against other
   sprints** (overlaps allowed); start and complete on any day.
8. **MCP tools.** Agents cannot manage sprints, so they only need to read them.
   **Recommend: add `opanel_list_sprints` in item F**; the alternative is a follow-up, as
   WT-08 did with epics.
9. **A completed sprint's page.** **Recommend: none in v1**: the backlog lists completed
   sprints with their frozen points, each linking to the list view filtered by it.
10. **Track order.** **Recommend: start A and B in parallel; then C; then D and F; E; G
    last.**

Risks:

- **Decision 5 changes what "on the board" means** for every path that writes `column_id`:
  create, move, edit, delete and restore, the triage pipeline, sub-task epic sync. Item C's
  work-spec lists them, and its tests run each in both kinds of project.
- **Starting and completing touch many tasks** in one transaction, each with a history
  entry and an event. A sprint has no size limit; a work-spec measures a 500-task start and
  proposes one if it is slow.
- **The board list's answer changes for sprint projects**, which agents and the MCP
  `opanel_get_board` read. No project has sprints today, so no client sees a change until a
  Manager turns them on; `docs/agents.md` says so.
- **Turning sprints off brings completed sprints' done tasks back to the board**, since
  without sprints the board shows every task with a column. The setting's notice says so;
  an alternative is moving them to the backlog when sprints are turned off.
