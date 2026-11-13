# WT-03 — Board core: projects, teams, columns, epics, tasks, comments, assignment

- Status: In progress (approved by the owner on 2026-11-13)
- Canonical docs: [0003](../canonical/0003-task-management.md) (sections 2 to 5, 9),
  [0002](../canonical/0002-realtime-sync.md) (section 4, consistency rules),
  [0004](../canonical/0004-api-conventions.md),
  [0001](../canonical/0001-ai-qa-agents-and-triage.md) (section 7, data model sketch)

## Goal

People can work a project on a kanban board: a Manager creates projects, teams, columns and
epics; a Member creates tasks, edits them, moves them between columns, assigns them to a
team or a person, and comments on them; a Viewer sees everything and changes nothing. Every
task change is recorded as a history event in the same transaction, and every write follows
the concurrency rules of doc 0002, so WT-04 only adds the live push.

## In scope

- Teams and team membership (API and an admin page).
- Projects: create, edit, archive, unarchive; immutable project key; three default columns.
- Columns per project: create, rename, change category, reorder, delete when empty, with at
  least one `done` column always kept.
- Epics: create, edit, close and reopen; a task's epic; progress as done tasks over total.
- Tasks: create, read by id or key, list in board order, edit, move, assign, soft delete
  and restore. Fields of this track: key, type, title, description, column, position,
  assignee team, assignee person, reporter, epic, `version`.
- Comments on tasks: create and list.
- Task history events (doc 0003 section 9), written from the first version of the task
  service. No timeline UI yet.
- Optimistic concurrency (`version`, `409 version_conflict`) and fractional positions
  (doc 0002 section 4).
- UI: navigation to projects, projects list, project settings (details, columns, deleted
  tasks), board with drag and drop, task detail with Markdown description and comments,
  epics page, teams page.

## Out of scope

- Live sync, `NOTIFY` and the events endpoint (WT-04). This track leaves one place in each
  service where WT-04 adds the notification.
- Agent accounts and tokens (WT-05). Services take an `Actor` as today; agents simply do not
  exist yet.
- The project's fallback triage team and routing rules (WT-06).
- Backlog, priority, due dates, labels (WT-07). In this track every task is in a column.
- Search, filters (including filtering the board by epic), list view, activity timeline
  (WT-08).
- Sub-tasks and links (WT-09); sprints and story points (WT-10).
- Severity, fingerprint, occurrences (WT-06).
- Editing or deleting comments (see question 2).

## Design decisions

Choices the canonical docs leave open. Each is detailed in the work-spec of the item that
implements it. The owner approved all of them as proposed on 2026-11-13.

1. **Checks move into the `route()` wrapper** (WS-023, question 1). A handler is declared as
   `route({ auth: "permission", permission: "tasks:write" }, handler)`, or
   `{ auth: "account" }` for the authentication-only list, or `{ auth: "public" }`. The
   wrapper authenticates, checks the permission, checks the origin on state-changing
   methods, and passes the `Actor` to the handler. The guard-rail test then checks the
   declaration against the contract instead of searching handler text. Reason: this track
   adds about 30 endpoints; a handler that cannot exist without declaring its checks is
   stronger than a text search. The existing endpoints (twelve handlers, plus health and the OpenAPI document) are converted first (WI-025),
   with no behaviour change. Object-level rules (a Member deleting only their own task)
   stay in the services.
2. **Project keys** are 2 to 10 characters, uppercase letters and digits, starting with a
   letter, unique, and **cannot be changed** after creation, because task keys never change
   (doc 0003 section 2). The name and description can change.
3. **Task numbers** come from a counter on the project row (`next_task_number`), taken with
   `UPDATE ... RETURNING` inside the creating transaction. The row lock serialises
   concurrent creations in one project; numbers are never reused, including after a delete.
4. **Archived projects** are read-only: every write to the project or anything in it returns
   `409` with code `project_archived`. They are hidden from the projects list unless
   `archived=true` is asked for. Projects are never deleted in v1.
5. **Positions** are fractional-index strings (base-62 keys that sort as plain text, with a
   key always available between two others), implemented in
   `src/lib/position.ts` with no dependency. Used for columns and for tasks within a column.
   Clients send neighbours (`afterId` / `beforeId`), never position values; the server
   computes the key. Alternative considered: a `double precision` column, rejected because
   precision runs out after about 50 moves between the same two cards.
6. **Moving is its own endpoint**, `POST /api/v1/tasks/{idOrKey}/move` with
   `{ columnId, afterTaskId?, beforeTaskId?, version }`, so WT-04 can emit `task.moved`
   separately from `task.updated`. It checks `version` like any update.
7. **`version`** exists on tasks, columns, epics and projects. Every `PATCH` and move must
   send it; a mismatch returns `409 version_conflict` with the current entity as `current`
   (doc 0004 section 4). Teams have no `version`: their edits are rename and membership,
   and the last write wins.
8. **Assignment**: a task may have a team, a person, both or neither, and the person need
   not belong to the team (doc 0003: "any team or person"). Only active human accounts can
   be newly assigned; a task keeps showing a person who was later deactivated.
9. **Teams** have a unique name. A team that any task is assigned to cannot be deleted
   (`409 team_in_use`); it can be renamed. Members are human accounts.
10. **Columns**: a project starts with "To do" (`todo`), "In progress" (`in_progress`) and
    "Done" (`done`). Deleting a non-empty column, or deleting or recategorising the last
    `done` column, returns `409`. A project's columns are returned whole
    (`nextCursor: null`, doc 0004 section 5).
11. **Board listing**: `GET /api/v1/projects/{id}/tasks` returns tasks ordered by column
    position, then task position, with a keyset cursor on those two values and the id.
    The board loads every page. Soft-deleted tasks are excluded, except with
    `deleted=true`, which needs `tasks:delete_any`.
12. **Soft delete**: `deleted_at` and `deleted_by`. Members (`tasks:delete_own`) may delete
    tasks they reported; Managers and Admins (`tasks:delete_any`) any task, and they restore
    with `POST /api/v1/tasks/{idOrKey}/restore`. A deleted task returns `404` to everyone
    except through that list and the restore endpoint.
13. **History events** go in a `task_events` table: task id, actor account, time, event type,
    field, old value, new value (JSON). Created, field changed, moved, deleted, restored,
    commented. Append-only: no API writes or deletes them. Comments are stored separately;
    a `commented` event only points at the comment.
14. **Markdown** (task descriptions, epic descriptions, comments) is stored as text and
    rendered in the browser with `react-markdown`, with raw HTML disabled and links
    restricted to `http`, `https` and `mailto`. Its exact version is pinned by the
    work-spec that adds it.
15. **Drag and drop** uses `@dnd-kit` (core and sortable), which supports keyboard moves.
    Every move is also possible without dragging, from the task detail (column select).
    Versions pinned by the work-spec.
16. **Audit log versus history** (see question 1): configuration changes (teams, membership,
    projects, columns, epics) are written to the audit log; task and comment changes are
    written to `task_events`, which record the actor as hard rule 8 requires.

## Proposed amendments (awaiting owner approval)

From the audit of `main` on 2026-11-13. The track above is approved as it stands; nothing
in this section is decided until the owner approves it. Once approved, each amendment is
folded into the decision or work-item it names and this section is removed.

**A1. A people directory that every signed-in person can read.** Assigning a task to a
person (decision 8) and choosing team members (decision 9) both need a list of accounts to
pick from. The only list today is `GET /api/v1/accounts`, which needs `accounts:manage`:
Admins only. A Member cannot assign a task to anyone, and a Manager cannot add anyone to a
team.

- Proposed: `GET /api/v1/people`, permission `projects:read` (every human role has it).
  It returns human accounts as `{ id, name, active }`, ordered by name, paginated, with an
  optional `q` that matches the start of a name. It never returns emails, roles or
  invitation state: those stay behind `accounts:manage`. Invited accounts that have not
  chosen a password are left out; deactivated ones are included with `active: false`, so
  a task assigned to someone who left can still show their name.
- Built in WI-026 (teams), which needs it first.
- Doc 0001 section 3 describes the `projects:read` scope as "List projects, teams and
  routing layers"; it would read "projects, teams, people and routing layers". Agents with
  that scope would therefore see names of people, which they need in order to read who a
  task is assigned to.
- Alternative: a new permission `people:read` given to every human role and to no agent
  scope. More precise, one more entry in the catalogue of doc 0003.

**A2. Position columns use byte-order collation.** Decision 5 relies on position keys that
"sort as plain text". PostgreSQL sorts `text` by the database's collation, which for most
installs is a language collation, not byte order: under `en_US.UTF-8`, `"a"` sorts before
`"B"`, while the base-62 keys need `"B"` before `"a"`. Without a fix, cards and columns
change order on some installs and not on others.

- Proposed addition to decision 5: every position column is declared `COLLATE "C"`, and
  every query that orders by it relies on the column's collation (no `ORDER BY` with
  another collation).
- WI-028, which creates the first position column, gets an integration test on the real
  database: keys that differ only by case, generated by `src/lib/position.ts`, come back
  from `ORDER BY position` in the order the library says.
- WI-027 states in `src/lib/position.ts` that the keys must be compared by code unit, and
  tests the JavaScript side with a plain `<` comparison, never `localeCompare`.

**A3. Epic fields are those of doc 0003.** The track lists what can be done to an epic but
not its fields. Doc 0003 section 4 gives an epic a title, a description, a status (`open`
or `closed`) and optional start and target dates.

- Proposed: WI-033 implements all five, the two dates as calendar dates (`YYYY-MM-DD`, doc
  0004), with the target date not before the start date when both are set. Progress in
  this track is done tasks over total; story points join it in WT-10.

**A4. Two hardening items join the track.** WI-040 (account links) and WI-041 (security
headers and Content Security Policy), both `Proposed`, in the table below. WI-041 has to be
done before WI-038, the first item that shows text written by users.

A note that needs no decision: doc 0001 section 6 has the triage pipeline add **system
comments** to a task. WS-034 should give the comments table a `kind` and a nullable author
from the start, so WT-06 adds a value, not a redesign.

## Work-items

Each item leaves the repository green and is one branch/PR. API items include their
integration tests and OpenAPI contracts; UI items include their end-to-end tests.

| Item                                                     | Title                                                                             | Status   | Depends on             |
| -------------------------------------------------------- | --------------------------------------------------------------------------------- | -------- | ---------------------- |
| [WI-025](../work-items/WI-025-route-declares-access.md)  | `route()` declares authentication and permission; existing endpoints converted    | Done     | none                   |
| WI-026                                                   | Teams and membership: schema, service, API                                        | Draft    | WI-025                 |
| WI-027                                                   | Fractional positions (pure logic) and the `version_conflict` response             | Draft    | none                   |
| WI-028                                                   | Projects with default columns: schema, service, API (create, edit, archive, list) | Draft    | WI-025, WI-027         |
| WI-029                                                   | Columns API: create, rename, recategorise, reorder, delete                        | Draft    | WI-028                 |
| WI-030                                                   | Tasks core: schema, keys, history events; create, get, list, edit, assign         | Draft    | WI-026, WI-029         |
| WI-031                                                   | Move a task between and within columns                                            | Draft    | WI-030                 |
| WI-032                                                   | Delete and restore a task                                                         | Draft    | WI-030                 |
| WI-033                                                   | Epics: schema, service, API; a task's epic; progress                              | Draft    | WI-030                 |
| WI-034                                                   | Comments: schema, service, API                                                    | Draft    | WI-030                 |
| WI-035                                                   | Teams page                                                                        | Draft    | WI-026                 |
| WI-036                                                   | Projects list, navigation and project settings (details, columns, deleted tasks)  | Draft    | WI-029, WI-032         |
| WI-037                                                   | Board page: columns, cards, create a task, drag and drop                          | Draft    | WI-031, WI-036         |
| WI-038                                                   | Task detail: fields, Markdown description, assignment, epic, comments, delete     | Draft    | WI-033, WI-034, WI-037 |
| WI-039                                                   | Epics page: list, create, edit, close, progress                                   | Draft    | WI-033, WI-036         |
| [WI-040](../work-items/WI-040-account-link-hardening.md) | Account link hardening (from the audit of 2026-11-13)                             | Proposed | none                   |
| [WI-041](../work-items/WI-041-security-headers.md)       | Security headers and Content Security Policy (from the audit of 2026-11-13)       | Proposed | none; before WI-038    |

As before, each item gets its work-item and work-spec files just before it is started.

## Exit criteria

- [ ] A Manager creates a project, finds it with "To do", "In progress" and "Done", renames,
      reorders and adds columns, and cannot delete a non-empty column or the last `done`
      column.
- [ ] A Member creates tasks on the board; they get keys `KEY-1`, `KEY-2`, ... with no gap or
      duplicate under concurrent creation; they can be fetched by id or by key.
- [ ] A Member moves a card by drag and drop and by keyboard; the order survives a reload.
- [ ] A Member assigns a task to a team, a person or both, sets its epic, edits its Markdown
      description (rendered with no raw HTML), comments, and deletes a task they reported
      but not another person's; a Manager restores it.
- [ ] A Viewer sees projects, boards, tasks, epics and comments and gets `403` from every
      write endpoint of this track; this is tested for every endpoint.
- [ ] An update or move with a stale `version` returns `409 version_conflict` with the
      current entity.
- [ ] Every task change produces exactly one history event per changed field in the same
      transaction, and none after a rollback; every configuration change is in the audit
      log with its actor.
- [ ] Writes to an archived project return `409 project_archived`.
- [ ] Every endpoint declares its authentication and permission through `route()`, checked
      by the guard-rail test.
- [ ] The full quality gate passes on `main`, with `pnpm db:generate` and
      `pnpm openapi:generate` leaving no diff.

## Risks and open questions

Questions 1 to 4 were resolved by the owner on 2026-11-13, by approving the proposals.

1. **Resolved: hard rule 8 versus doc 0003 section 9.** `task_events` is the record of the
   acting account for task and comment changes; configuration changes go to the audit log
   (decision 16). Hard rule 8 in `AGENTS.md` now reads "in the audit log or, for task and
   comment changes, the task history".
2. **Resolved: comments** are created and read only in this track. Editing and deleting
   them is not planned.
3. **Resolved: the task detail** has its own URL (`/projects/KEY/tasks/KEY-12`) and opens as
   a dialog over the board when reached from it.
4. **Resolved: projects have no default teams.** Teams matter for assignment now and for
   routing in WT-06.
5. **Open risk, large boards:** the board loads every page of tasks. Acceptable until WT-07
   moves unscheduled work to the backlog; measured in WI-037 with 1 000 tasks.
6. **Open, from the audit of 2026-11-13:** amendments A1 to A4 above await the owner's
   approval. A1 and A2 change WI-026, WI-027 and WI-028, so they should be decided before
   those items are drafted.
