# 0003 — Task management: roles, tickets, boards and planning

- Status: **Approved** (2026-11-12)
- Date: 2026-11-12
- Amends: [0001](0001-ai-qa-agents-and-triage.md) (human roles, task links, see section 12)
- Amended by: [WT-06](../work-tracks/WT-06-bug-reports-and-triage.md) decision 9 (section 7: the `task_links` table and its first type; applied 2026-11-20 by WI-094);
  [WT-08](../work-tracks/WT-08-search-filters-list-timeline.md) proposals P2 and P3 (sections 8 and 4: search, the list view, the epic filter; applied 2026-11-26 by WI-131);
  [WT-09](../work-tracks/WT-09-subtasks-and-links.md) proposals P1 to P3 (sections 7 and 3: a sub-task's epic and deleting a parent, who links and how links are stored, the link permission; applied 2026-11-27 by WI-138)

## 1. Context

Opanel is first of all a project management tool for people. Project managers, product
owners and engineers create, plan, assign and work tickets as they would in Jira; AI
agents are one more source of tickets on the same boards. This doc defines the human side.

Decisions taken with the owner:

| Topic         | Decision                                                                 |
| ------------- | ------------------------------------------------------------------------ |
| Human roles   | Admin, Manager (the PM/PO role), Member, Viewer                          |
| Member rights | Full ticket work; only structural configuration is reserved for Managers |
| Ticket types  | Fixed set: Task, Bug, Story. Epic is the grouping level above them       |
| Planning      | Priority, due date, labels, backlog, sprints                             |
| Sprints       | Optional per project; one board implementation either way                |
| Estimates     | Optional story points with sprint and epic totals; no charts             |
| Ticket extras | Sub-tasks, task links, search and filters, activity history              |
| Delivery      | All in v1, built in phases, with agent triage right after the board core |

## 2. Domain model

```
Organization (one per install)
 ├─ Teams ── members (accounts)
 └─ Projects (key, e.g. "OPA")
     ├─ Columns (ordered, per project)
     ├─ Labels
     ├─ Sprints (only if the project has sprints enabled)
     ├─ Epics
     └─ Tasks (type: task | bug | story), key "OPA-123"
         ├─ Sub-tasks (one level)
         ├─ Links to other tasks
         ├─ Comments
         └─ Activity history
```

Every task has a human-readable key: the project key plus a per-project sequence number.
Keys never change and are never reused.

## 3. Roles and permissions

Roles are organization-wide in v1: an account has one role, and it applies to every
project. All projects are visible to all signed-in humans.

| Capability                                                         | Viewer | Member | Manager | Admin |
| ------------------------------------------------------------------ | :----: | :----: | :-----: | :---: |
| Read projects, boards, tasks, comments, history                    |   ✓    |   ✓    |    ✓    |   ✓   |
| Create, edit, move and delete tasks and sub-tasks; link tasks      |        |   ✓    |    ✓    |   ✓   |
| Assign tasks to any team or person; set priority, due date, points |        |   ✓    |    ✓    |   ✓   |
| Comment; apply labels; create new labels                           |        |   ✓    |    ✓    |   ✓   |
| Put tasks into, or take them out of, a sprint or the backlog       |        |   ✓    |    ✓    |   ✓   |
| Create, edit, archive projects; configure columns                  |        |        |    ✓    |   ✓   |
| Create, edit, close epics                                          |        |        |    ✓    |   ✓   |
| Create, start, complete sprints; enable sprints on a project       |        |        |    ✓    |   ✓   |
| Rename and delete labels                                           |        |        |    ✓    |   ✓   |
| Manage teams and team membership; edit triage routing rules        |        |        |    ✓    |   ✓   |
| Invite, deactivate and change the role of human accounts           |        |        |         |   ✓   |
| Create and manage agent accounts and API tokens                    |        |        |         |   ✓   |
| Organization settings                                              |        |        |         |   ✓   |

Internally each row is a permission (the catalogue is `src/lib/schemas/permissions.ts`;
some rows are split in two, e.g. delete own and any task, labels write and manage)
checked by the service layer, the same mechanism as
agent scopes in doc 0001. A human role is a fixed bundle of permissions. Agents are not
affected by this table: they keep their own scopes.

Deleting a task is a soft delete (it disappears from views and can be restored by a
Manager). Members may delete only tasks they reported; Managers may delete any.

## 4. Tickets

| Field        | Notes                                                           |
| ------------ | --------------------------------------------------------------- |
| Key          | `OPA-123`, assigned on creation                                 |
| Type         | `task`, `bug` or `story`. Agent-filed tickets are always `bug`  |
| Title        | Required                                                        |
| Description  | Markdown, rendered safely (no raw HTML)                         |
| Status       | The column the task is in, or "in backlog" when it has none     |
| Priority     | `none`, `low`, `medium`, `high`, `urgent`. Default `none`       |
| Severity     | Bugs only: `low` to `critical`. Set by the reporter (see below) |
| Due date     | Optional date, no time of day                                   |
| Story points | Optional non-negative number                                    |
| Labels       | Zero or more, per project, each with a name and colour          |
| Assignee     | A team, a person, or both                                       |
| Reporter     | The human or agent account that created it                      |
| Epic         | Optional, same project                                          |
| Parent       | Set on sub-tasks only                                           |
| Sprint       | Optional, only in projects with sprints enabled                 |

**Severity is not priority.** Severity is the reporter's assessment of impact and is what
an AI agent sends with a bug report. Priority is the team's decision about ordering.
Priority is set by people and by agents holding `tasks:write`; the triage pipeline never
sets it. An agent-filed bug arrives with a severity and priority `none`.

**Epics** have a title, description, status (`open` or `closed`), optional start and
target dates, and show progress as done tasks and done story points over their totals.
Epics are not cards on the board; the board can be filtered by epic.

## 5. Board, columns and backlog

- Each project has its own ordered columns. Every column belongs to one of three
  categories: `todo`, `in_progress` or `done`. The category drives everything that needs
  to know whether work is finished (epic progress, sprint completion, bug dedupe in doc
  0001), so columns can be renamed and reordered freely. This generalises the single
  "done" flag sketched in doc 0001.
- A new project starts with "To do", "In progress" and "Done".
- A column can be deleted only when empty, and at least one `done` column must remain.
- There are no workflow rules: any task can move to any column.
- The **backlog** is the list of tasks that are not on the board. It is ordered by drag
  and drop, and that order is the team's ranking.
- A task in the backlog has no column. A new task goes to the first column unless it is
  created in the backlog; agent-filed bugs follow section 13.
- Live updates and concurrent-edit rules for all of this follow doc 0002.

## 6. Sprints

Sprints are a per-project setting, off by default.

- **Off:** the board shows every task that has a column. The backlog holds the rest.
- **On:** the board shows only tasks in the active sprint. The backlog view lists planned
  sprints in order, followed by unscheduled tasks.

Rules:

- A sprint has a name, optional goal, start and end dates, and a state: `planned`,
  `active` or `completed`.
- At most one sprint is active per project.
- **Starting** a sprint puts its tasks that have no column into the first column.
- **Completing** a sprint leaves tasks in `done` columns attached to it as its record.
  For unfinished tasks the Manager chooses: move to the next planned sprint, or return to
  the backlog.
- Tasks can be added to or removed from an active sprint; the change is recorded in the
  task's activity history.
- A sprint shows its total and completed story points. No burndown or velocity charts.
- Turning sprints off is allowed only when no sprint is active.

## 7. Sub-tasks and links

**Sub-tasks**

- A sub-task is a task with a parent. One level only: a sub-task cannot have sub-tasks.
- It belongs to its parent's project and epic, and has its own assignee, status and card
  on the board, marked with its parent's key.
- The parent shows a progress count. Nothing is automatic: finishing all sub-tasks does
  not move the parent, and moving the parent does not move them. A sub-task's epic is its
  parent's. A parent with sub-tasks cannot be deleted until they are deleted or detached;
  a sub-task restored after its parent was deleted becomes a normal task.

**Links**

| Type          | Reverse reading  |
| ------------- | ---------------- |
| blocks        | is blocked by    |
| duplicates    | is duplicated by |
| regression of | has regression   |
| relates to    | relates to       |

Links may cross projects. They are informational: a blocked task can still be moved.
`regression of` is the link the triage pipeline creates when a bug reappears after its
ticket was closed (doc 0001, section 6).

Links are stored in `task_links`. People and agents holding `tasks:write` on both tasks add
and remove links of every type; the triage pipeline also adds `regression of`. `relates to`
is stored once. Every link added or removed is in the history of both tasks. A task's
answer (`links`) lists its links in both directions and leaves out links to deleted tasks
(WS-090).

## 8. Search and filters

- Text search over key, title and description, using PostgreSQL full-text search. No
  separate search service.
- Filters: project, type, status or column category, assignee (person or team), reporter
  (including "filed by an agent"), label, epic, sprint, priority, severity, due date range.
- Filters apply to the board and to a list view with sortable columns.
- The current filter lives in the URL, so a filtered view can be shared as a link.
- Search uses the `simple` configuration, so it treats every language alike; a key finds
  its task. The list view lists tasks across projects; the sprint filter comes with WT-10.

## 9. Activity history

Every change to a task is recorded as an event: who (human or agent), when, which field,
old value, new value. The task page shows events and comments on one timeline.

- Events are written in the same transaction as the change, from the first version of the
  task service, so history is complete even before the timeline UI exists.
- The same write produces the live-sync notification of doc 0002.
- History is append-only and cannot be edited or deleted through the API.

This is separate from the audit log of doc 0001, which records security and administrative
actions (sign-ins, token creation, role changes).

## 10. Delivery phases

This replaces the work-track order in `docs/README.md`.

| Track | Content                                                                  |
| ----- | ------------------------------------------------------------------------ |
| WT-01 | Project boilerplate (in progress)                                        |
| WT-02 | Accounts, human sign-in, the four roles and the permission layer         |
| WT-03 | Board core: projects, teams, columns, epics, tasks, comments, assignment |
| WT-04 | Real-time board sync                                                     |
| WT-05 | Agent accounts and API tokens                                            |
| WT-06 | Bug reports and automated triage                                         |
| WT-07 | Backlog, priority, due dates, labels                                     |
| WT-08 | Search, filters, list view, activity timeline                            |
| WT-09 | Sub-tasks and task links                                                 |
| WT-10 | Sprints and story points                                                 |

The first usable release for a human-only team is the end of WT-04; the product's
distinguishing feature lands at WT-06.

## 11. Out of scope (v1)

- Custom fields, custom ticket types, workflow rules or transition restrictions.
- Per-project roles or private projects.
- Burndown, velocity and other reports or dashboards.
- Saved filters, time tracking, watchers, @mentions.
- Import from Jira or other tools.
- Attachments and notifications (already excluded in doc 0001).

## 12. Amendments to doc 0001

Applied to doc 0001 on 2026-11-12.

- Human roles are `admin`, `manager`, `member`, `viewer` (was `admin`, `member`).
- Routing rules and teams are managed by Managers and Admins (agent accounts and tokens
  stay Admin-only).
- "Done" for dedupe purposes means a column in the `done` category.
- The regression reference between tasks is a `regression of` link, not a dedicated
  column.
- A new agent-filed bug is placed in the first board column only when the project does
  not use sprints; with sprints it goes to the top of the backlog (section 13).

## 13. Resolved questions

Decided with the owner on 2026-11-12:

1. **Agent-filed bugs in sprint projects** go to the top of the backlog, so a person
   decides whether they enter the running sprint. In projects without sprints they go to
   the first board column, as in doc 0001.
2. **Roles are organization-wide:** one role per person for the whole install, and all
   projects are visible to every signed-in human. Per-project roles are out of v1.
3. **Deleting tasks:** Members may delete only tasks they reported, Managers and Admins
   any. Deletion is always a restorable soft delete.
