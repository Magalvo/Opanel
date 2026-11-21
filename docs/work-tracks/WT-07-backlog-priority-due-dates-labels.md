# WT-07 — Backlog, priority, due dates, labels

- Status: Approved by the owner on 2026-11-21: decisions 1 to 15, proposals P1 to P3 and
  questions 1 to 9 as recommended.
- Canonical docs: [0003](../canonical/0003-task-management.md) (section 3: who may put
  tasks into or out of the backlog, apply, create, rename and delete labels; section 4:
  priority, due date, labels; section 5: the backlog; section 6: what WT-10 adds to the
  backlog later; section 13: placement of agent-filed bugs),
  [0002](../canonical/0002-realtime-sync.md) (section 4: events; amended by this track, see
  proposal P1), [0004](../canonical/0004-api-conventions.md) (calendar dates, versioning),
  [0001](../canonical/0001-ai-qa-agents-and-triage.md) (section 3: agent scopes; section 6:
  "open" for dedupe), [0005](../canonical/0005-mcp-server.md) (tool inputs follow the
  request schemas)

## Goal

A team plans its work, not only runs it: tasks that are not on the board wait in a
project's backlog, ranked by drag and drop; any task can carry a priority, a due date and
labels. A Member moves tasks between the backlog and the board, sets priority and due
date, applies labels and creates new ones; a Manager renames and deletes labels. Every
change is in the task history and reaches open boards and backlogs live.

## Depends on

- **WT-03** (board core): tasks, columns and their categories, fractional positions,
  `version`, task history, the board and task detail.
- **WT-04** (live sync): `task.*` events; this track adds one event type (proposal P1).
- **WT-05** (agents): project restrictions (`requireProjectAccess`) and agent scopes;
  agents read everything this track adds.
- **WT-06** (triage): the pipeline's "open task" lookup must count a bug in the backlog as
  open (decision 4).
- **WT-11** (MCP server, in progress): tool inputs are built from the request schemas of
  `src/lib/schemas/tasks.ts`, so the new task fields reach `opanel_update_task` and
  `opanel_move_task` with no work in `mcp/` (risk 2).

## Starting point

Checked on 2026-11-21 against `main` (`5f46e07`):

- `tasks.column_id` is `not null`, with a unique index on `(column_id, position)`
  (`src/server/db/schema/tasks.ts`). Every task is on the board; there is no backlog.
- `tasks` has no `priority`, `due_date` or labels; there is no `labels` table.
- `labels:write` (Member and above) and `labels:manage` (Manager and above) are already in
  the permission catalogue and the human roles (`src/server/auth/roles.ts`); nothing checks
  them yet. No agent scope includes either (`AGENT_SCOPES`).
- `GET /projects/{projectId}/tasks` returns tasks in board order with a keyset cursor on
  column position, task position and id; the board loads every page.
- `createTask` puts a task at the end of the first column, or of `columnId`;
  `placeNewBug` puts an agent-filed bug at the top of the first column.
- The triage pipeline finds an open bug with `tasks join columns ... category <> 'done'`
  (`src/server/services/bug-reports.ts`); a task with no column would be invisible to it.
- Epic progress counts every task in its total and joins columns only for "done", so a task
  with no column counts as not done with no change.
- There is no tagged release, so v1 may still change a type (doc 0004 section 8).

## In scope

- The backlog: a task may have no column; it then has a place in the project's backlog
  order. Create a task in the backlog, move a task between the backlog and the board,
  reorder the backlog, list it.
- Priority (`none`, `low`, `medium`, `high`, `urgent`) and due date (a calendar date) on
  every task: create, edit, history, OpenAPI.
- Labels per project (name and colour): list, create, rename, recolour, delete; apply to
  and remove from tasks; history; audit.
- The UI: a Backlog page per project; priority, due date and labels on cards and in the
  task detail; a "Labels" section in the project's settings.
- The triage pipeline's open-task lookup and the board list made correct for tasks with no
  column.
- `docs/agents.md` and the canonical amendments of proposals P1 to P3.

## Out of scope

- Sprints, the sprint grouping of the backlog, and the placement of agent-filed bugs at
  the top of the backlog in sprint projects (WT-10; doc 0003 sections 6 and 13). In this
  track a new agent-filed bug still goes to the top of the first column, which is what
  doc 0003 asks for in projects without sprints.
- Search, filters (by priority, label, due date), sorting, the list view and the timeline
  UI (WT-08). This track records the history the timeline will show.
- Story points (WT-10), sub-tasks and links (WT-09).
- Reminders or notifications about due dates (doc 0003 section 11: no notifications).
- Any automatic placement or ordering by priority or due date: the backlog order is the
  team's ranking (doc 0003 section 5).
- New MCP tools (a backlog or labels tool): a WT-11 follow-up (question 7).
- Labels for agents (question 5).

## Design decisions

Choices the canonical docs leave open. Each is detailed in the work-spec of the item that
implements it.

1. **A backlog task has no column.** `tasks.column_id` becomes nullable; "in backlog" is
   `column_id is null`, which is doc 0003 section 4's "the column the task is in, or in
   backlog when it has none". The existing `position` column orders the backlog too: the
   unique index on `(column_id, position)` keeps the board, and a partial unique index on
   `(project_id, position) where column_id is null` keeps the backlog. No separate rank
   column. Existing tasks keep their columns; nothing moves on its own.

2. **Moving is the one move endpoint.** `POST /tasks/{taskId}/move` accepts
   `columnId: null` for the backlog, with `afterTaskId` / `beforeTaskId` naming backlog
   tasks, and without them the task goes to the end of the backlog (as it does in a
   column). A move from the backlog to a column works as today. It checks `version`,
   writes one `moved` history entry (old and new column, `null` for the backlog) and sends
   `task.moved`. The task's `columnId` in every answer becomes `uuid | null` (question 8).
   Permission `tasks:write`, as doc 0003 section 3 ("put tasks into, or take them out of,
   ... the backlog").

3. **Reading the backlog is its own endpoint.**
   `GET /api/v1/projects/{projectId}/backlog` (`tasks:read`) returns backlog tasks in
   backlog order, paged with a keyset cursor on position and id, items as
   `TaskSummary`. `GET /projects/{projectId}/tasks` keeps its meaning, "tasks in board
   order", and therefore returns only tasks with a column; its cursor needs no change, and
   the board and `opanel_get_board` load only the board (question 2). Deleted backlog tasks
   appear in the existing deleted list (`deleted=true`) and restore to their backlog place.

4. **A bug in the backlog is open.** Doc 0001 section 6 calls a task open when it is not
   deleted and not in a `done` column; a task with no column is not in one. The pipeline's
   open lookup becomes a `left join` on columns (`c.category is distinct from 'done'`), so
   a repeated report counts on a bug someone moved to the backlog instead of filing a
   duplicate; the closed lookup is unchanged. One test per case.

5. **Creating a task** keeps its default: the end of the first column, or of `columnId`.
   `columnId: null` creates it at the end of the backlog (question 1). `placeNewBug` is
   unchanged (out of scope above).

6. **Priority** is `tasks.priority`, `text not null default 'none'`, checked against
   `none | low | medium | high | urgent` (doc 0003 section 4). Settable on create and
   `PATCH` with `tasks:write`; one `field_changed` history entry; `task.updated`. An
   agent-filed bug is created with `none` by the column default: the pipeline never sets
   priority (doc 0003 section 4, "set by people"; question 4 for agents with
   `tasks:write`).

7. **Due date** is `tasks.due_date`, a PostgreSQL `date`, nullable, exchanged as
   `YYYY-MM-DD` (doc 0004), any valid calendar date, past dates allowed. Settable and
   clearable (`null`) on create and `PATCH` with `tasks:write`; one history entry. A task
   is shown as **overdue** when its due date is before today **in the viewer's browser**
   and it is not in a `done` column; the server stores no time zone and computes nothing
   (doc 0003 section 4: "no time of day").

8. **Labels** are `labels(id, project_id, name, colour, version, created_at, updated_at)`:
   name trimmed, 1 to 40 characters, unique per project ignoring case; colour one of a
   fixed palette (question 3); at most 200 per project. `task_labels(task_id, label_id)`,
   primary key on both, at most 20 labels per task. A label belongs to one project and can
   be applied only to that project's tasks.

9. **The labels API.** `GET /projects/{projectId}/labels` (`tasks:read`) returns them all,
   ordered by name (`nextCursor: null`, like columns). `POST /projects/{projectId}/labels`
   (`labels:write`, doc 0003: Members "create new labels"). `PATCH /labels/{labelId}` for
   name and colour and `DELETE /labels/{labelId}` (`labels:manage`, doc 0003: "rename and
   delete labels"), each with `version`. Duplicate name: `409 label_name_taken`. Every
   label write is audited (`label.created`, `label.updated`, `label.deleted`) and answers
   `409 project_archived` on an archived project; every service calls
   `requireProjectAccess`.

10. **Applying labels** is `labelIds` on task create and `PATCH`, the whole set, replacing
    the previous one. It needs `labels:write` in addition to `tasks:write` (doc 0003 puts
    "apply labels" in the labels row); a body without `labelIds` needs only `tasks:write`.
    One `field_changed` entry for `labels`, whose old and new values are lists of
    `{ id, name }`, so the WT-08 timeline still reads a label's name after it is deleted.
    The task's answers gain `labels: LabelRef[]` (`{ id, name, colour }`, ordered by name).

11. **Deleting a label in use** removes it from its tasks in the same transaction: each
    affected task gets a `field_changed` entry for `labels` with the Manager as actor, its
    `version` grows and it sends `task.updated`, as doc 0002 requires of every
    version-bumping write; the audit entry counts the tasks (question 6). Renaming or
    recolouring a label changes no task (tasks hold the label's id) and writes no task
    history.

12. **A new event type, `label.changed`** (entity `label`, the label's `version`, `null`
    when deleted), sent by creating, editing and deleting a label, so open boards,
    backlogs and task details refresh label names and colours. New event types are not
    breaking (doc 0004 section 8); doc 0002's table gains the row (proposal P1).

13. **The Backlog page**, `/projects/KEY/backlog`, next to the board in the project's
    navigation: the backlog's tasks in order, drag and drop and keyboard reordering
    (`@dnd-kit`, as the board), "Add task" creating in the backlog, and on each row "Move to
    board" (end of the first column). The board's task detail gains "Backlog" in its column
    select. Both live. WT-10 later puts sprint sections above the unscheduled tasks on the
    same page.

14. **On cards and in the task detail.** A card shows its priority (an icon with an
    accessible name, nothing for `none`), its due date (marked when overdue, by text and
    not colour alone) and its labels as chips. The task detail edits all three; the labels
    picker creates a label when the person has `labels:write`. The project settings gain a
    "Labels" section: everyone reads it, `labels:manage` renames, recolours and deletes.

15. **Agents read all of it.** Priority, due date, labels and backlog tasks are in every
    answer agents already read. `docs/agents.md` describes the new fields and endpoints,
    and its doc check (WS-078) covers them.

## Proposed canonical changes

Not edited until approved, then applied by item G.

- **P1 — doc 0002, event types:** add `label.changed` (decision 12).
- **P2 — doc 0003 section 5:** "A task in the backlog has no column. A new task goes to the
  first column unless it is created in the backlog; agent-filed bugs follow section 13."
  (decisions 1 and 5).
- **P3 — doc 0003 section 4,** only if question 4 is answered as recommended: "Priority is
  set by people and by agents holding `tasks:write`; the triage pipeline never sets it."

## Work-items (outline)

Letters until each item starts; each gets its number on `main` when it starts, with its
work-spec.

| Item | Title                                                                                                                              | Depends on |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| A    | The backlog in the data model and API: nullable column, create and move to and from the backlog, `GET /backlog`, the triage lookup | none       |
| B    | Priority and due date: columns, create and `PATCH`, history, OpenAPI                                                               | none       |
| C    | Labels: tables, the labels API, audit, `label.changed`, `labelIds` on tasks, history, deleting a label in use                      | none       |
| D    | The Backlog page: list, reorder, add, move to the board; "Backlog" in the task detail's column select                              | A          |
| E    | Priority and due date in the UI: card and task detail, overdue                                                                     | B          |
| F    | Labels in the UI: chips, the task detail's picker, the "Labels" settings section                                                   | C          |
| G    | End-to-end flow, `docs/agents.md`, proposals P1 to P3, exit check                                                                  | D, E, F    |

A, B and C touch the same files (`tasks.ts` schema and service, one migration each), so
they run one after another, A first; D, E and F can then run in parallel.

## Exit criteria

- [ ] A Member creates a task in the backlog, reorders the backlog by drag and drop and by
      keyboard, moves a task to the board and back; the order survives a reload, and a
      second open backlog and board follow live.
- [ ] The board and `GET /projects/{projectId}/tasks` show only tasks with a column;
      `GET /projects/{projectId}/backlog` only those without, in backlog order.
- [ ] A repeated bug report counts on an open bug that is in the backlog and creates no
      duplicate (an integration test).
- [ ] A Member sets and clears priority and due date; each change is one history entry; a
      past due date on a task outside a `done` column shows as overdue.
- [ ] A Member creates a label and applies it; a Manager renames, recolours and deletes it;
      deleting a label in use removes it from its tasks with a history entry and a
      `task.updated` for each; every label write is audited.
- [ ] A Viewer, and an agent, get `403` from every new write endpoint, and an agent with
      `tasks:write` gets `403` when it sends `labelIds`; archived projects answer
      `409 project_archived`; the `requireProjectAccess` coverage test includes the new
      services.
- [ ] A stale `version` on a move to or from the backlog, or on a label write, answers
      `409 version_conflict` with the current entity.
- [ ] `docs/agents.md` and its doc check cover the new fields and endpoints; the OpenAPI
      document describes them; docs 0002 and 0003 carry the approved proposals.
- [ ] The full quality gate passes on `main`, with `pnpm db:generate` and
      `pnpm openapi:generate` leaving no diff.

## Risks and open questions

Resolved by the owner on 2026-11-21, by approving each recommendation:

1. **Where a new task goes.** Doc 0003 does not say. Keeping the first column changes
   nothing for people, agents and the MCP tools; the backlog would match Jira but would
   make every task created today vanish from the board. **Recommend: first column by
   default, `columnId: null` for the backlog (decision 5), and "Add task" on the Backlog
   page creates there.**
2. **A separate backlog endpoint** rather than a filter on the board list. The board list
   keeps its meaning and its cursor; the backlog has a different order and, in WT-10,
   sprint sections. **Recommend: `GET /projects/{projectId}/backlog` (decision 3).**
3. **Label colours from a fixed palette** (for example gray, red, orange, amber, green,
   teal, blue, indigo, purple, pink, each with a light and a dark rendering that passes
   WCAG AA) rather than any hex colour, which cannot guarantee readable chips in both
   themes. **Recommend: the fixed palette, stored by name.**
4. **May agents set priority?** Doc 0003 section 4 says priority "is set by people", but
   its section 3 puts priority in the `tasks:write` row, which `worker_agent` holds, and
   agents get no implicit permissions either way (hard rule 6). The sentence reads as a
   contrast with severity, which the reporting agent sets. **Recommend: agents with
   `tasks:write` may set priority and due date, attributed in the history; the triage
   pipeline never does; doc 0003 says so (P3).** The alternative is refusing `priority`
   from agents, a special case in the service.
5. **Agents and labels.** Applying labels needs `labels:write` (decision 10), which no
   agent scope includes, and adding it means amending doc 0001 section 3. **Recommend:
   agents read labels but do not apply them in v1; a Follow-up if a worker agent needs
   to.**
6. **Deleting a label that tasks use.** Doc 0003 lets Managers delete labels and says
   nothing about labels in use. Refusing (`409 label_in_use`) would make a Manager strip
   it from every task by hand. **Recommend: delete it and record the removal on each task
   (decision 11).**
7. **MCP tools for the backlog and labels.** WT-11 lists its tools in doc 0005 section 4;
   new ones are added by work-items. The existing tools gain the new fields on their own.
   **Recommend: none in this track; a WT-11 follow-up for `opanel_get_backlog` and
   `opanel_list_labels`, recorded on `main` when this track is approved.**
8. **`columnId` becomes nullable in task answers** (decision 2), which doc 0004 section 8
   calls "changing a type". It is allowed because there is no tagged release yet, and the
   MCP server parses answers with the same schemas. **Recommend: accept it in v1 now,
   before the first release.**
9. **Track order.** WT-11 item B (WI-100) is in progress in `mcp/`. WT-07's items touch
   `src/` only, but B's tools follow `tasks.ts`. **Recommend: start item A once this track
   is approved, in parallel with WT-11, and have each branch take in `main` before merging
   (`AGENTS.md` section 8).**

Risks:

- **Nullable `column_id` touches every query that joins columns** (`listTasks`, the
  pipeline, moves, restore, epics). Item A's work-spec lists each one and tests a backlog
  task through it; `tsc` will not catch a raw `sql` join (follow-up D08).
- **The MCP server parses answers with the shared schemas.** Items A to C change the task's
  answer; WI-100's branch, if not yet merged, must take them in and rerun its tests.
- **Deleting a popular label writes many tasks in one transaction** (decision 11). At most
  the project's tasks; item C measures it with 1 000 labelled tasks.
- **Board size** (WT-03 risk 5) shrinks only when teams move work to the backlog; nothing
  moves it on its own.
