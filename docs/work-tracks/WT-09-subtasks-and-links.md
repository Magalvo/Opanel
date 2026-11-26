# WT-09 — Sub-tasks and task links

- Status: Approved by the owner on 2026-11-26: decisions 1 to 13, proposals P1 to P3
  and questions 1 to 9 as recommended.
- Canonical docs: [0003](../canonical/0003-task-management.md) (section 2: the model;
  section 3: "create, edit, move and delete tasks and sub-tasks", "link tasks"; section 4:
  the `Parent` field; section 7: sub-tasks and links; section 8: the filters),
  [0001](../canonical/0001-ai-qa-agents-and-triage.md) (section 3: agent scopes; section
  6: the `regression of` link triage writes), [0002](../canonical/0002-realtime-sync.md)
  (section 3: the events a change sends), [0004](../canonical/0004-api-conventions.md)
  (sections 5 and 6: lists, writes), [0005](../canonical/0005-mcp-server.md) (section 4:
  the tools, question 8)

## Goal

A team splits work and connects it: a task gets sub-tasks, one level deep, each with its
own card, assignee and status, and the parent shows how many are done. Any two tasks can
be linked as blocking, duplicating, a regression of, or related to each other, across
projects, by people and by agents, and every link and parent change is in the history,
named after who made it.

## Depends on

- **WT-03** (board core): tasks, the board and the task page, soft delete and restore.
- **WT-04** (live sync): `task.*` events on the project stream.
- **WT-05** (agents): scopes and project restrictions, which links across projects must
  respect.
- **WT-06** (triage): the `task_links` table and its one type, `regression_of`, written
  only by the triage pipeline (WS-086, WS-090).
- **WT-07** and **WT-08**: epics on tasks, the backlog, the filters, the activity timeline,
  and `GET /tasks`, which a link picker searches.

## Starting point

Checked on 2026-11-26 against `main` (`4819052`):

- `tasks` has no parent column. Doc 0003 section 4 lists `Parent` ("set on sub-tasks
  only"); no schema, API or UI has it.
- `task_links` (`from_task_id`, `to_task_id`, `type`, `created_by`, `created_at`; primary
  key on the three first) allows only `regression_of`, by a check constraint, and refuses a
  self-link. Only `fileBugReport` writes it.
- A task's answer has `links`: both directions, `{ type, direction, task: { id, key,
title } }`, leaving out deleted tasks (`loadLinks`, WS-090). It does not leave out a
  task outside a restricted agent's projects.
- The task page shows links only inside the bug section (`bug-section.tsx`), and only for
  bugs or reported tasks. Nothing writes a link by hand.
- `task_events` allows `created`, `field_changed`, `moved`, `deleted`, `restored`,
  `commented` and `reported_again`; the activity endpoint and the timeline read them
  (WT-08). The triage pipeline's link has no history entry of its own.
- "Link tasks" sits in doc 0003 section 3's row with commenting and labels; the permission
  catalogue has no link permission. Agents hold `tasks:write` or not, and cannot apply
  labels (WT-07 question 5).
- There is no tagged release: v1 may still gain fields and endpoints (doc 0004 section 8).

## In scope

- Sub-tasks: a parent on a task, one level deep, in the parent's project, set when a task
  is created or edited and cleared again; the parent's progress count; the sub-tasks on
  the parent's answer and page; the parent's key on a sub-task's card.
- Links: the four types of doc 0003 section 7, created and removed by people and agents
  through the API and on the task page, across projects.
- History for both: who set or cleared a parent, who added or removed a link, on every
  task concerned, on the timeline.
- Live updates: a page showing a parent or a linked task follows the change.
- A `parentId` filter on the task lists.
- `docs/agents.md` and its doc check; the canonical amendments of proposals P1 to P3.

## Out of scope

- More than one level of sub-tasks (doc 0003 section 7).
- Anything automatic: finishing every sub-task does not move the parent, and a blocking
  link does not stop a move (doc 0003 section 7).
- Grouping the board by parent (swimlanes), as grouping by epic stays a follow-up.
- Sub-tasks and sprints (WT-10 decides how sub-tasks enter a sprint).
- A dependency graph or a "blocked" state on cards beyond the link list.
- New MCP tools (question 8).

## Design decisions

Choices the canonical docs leave open. Each is detailed in the work-spec of the item that
implements it.

1. **The parent is a column.** `tasks.parent_task_id`, nullable, a foreign key to `tasks`,
   with an index. The service refuses, with `400` on `parentId`: a parent in another
   project, a parent that is itself a sub-task, making a task with sub-tasks a sub-task,
   and a deleted parent. A task becomes a sub-task by `parentId` on create or `PATCH`, and
   a normal task again with `parentId: null`. Both write `version` as any edit does.
2. **A sub-task follows its parent's epic.** `epic_id` stays stored on each task, so the
   epic filter and progress work unchanged: setting a parent copies the parent's epic, and
   changing a parent's epic changes its live sub-tasks' in the same transaction, each with
   a history entry. A sub-task's own `epicId` in a write is a `400` (question 2).
3. **At most 100 live sub-tasks per parent and 100 links per task**, so every answer stays
   bounded (doc 0004 section 5 allows a small, naturally bounded collection in full). A
   write past the limit is a `409` with its own code.
4. **What a task answers.** `TaskSummary` gains `parent: { id, key, title } | null` and
   `subtasks: { done, total } | null` (`null` on a task without sub-tasks; done means in a
   `done` column). The full `Task` gains `subtasks`: its live sub-tasks as `TaskSummary`,
   in the parent's board order, then the backlog. No list endpoint is added for them.
5. **Deleting a parent with live sub-tasks is refused** with `409 has_subtasks`; people
   delete or detach the sub-tasks first (question 1). Restoring a sub-task whose parent is
   deleted restores it as a normal task, with a history entry clearing the parent.
6. **Links: four types, stored one way.** The check constraint allows `blocks`,
   `duplicates`, `regression_of` and `relates_to`. `relates_to` reads the same both ways,
   so it is stored once, from the task with the lower id, and answered as `outgoing` on
   both tasks; the others keep `outgoing` and `incoming` as today, and the UI reads
   `incoming` with doc 0003's reverse names ("is blocked by", …).
7. **The link endpoints.** `POST /tasks/{taskId}/links` with `{ type, direction, taskId }`
   and `DELETE /tasks/{taskId}/links` with the same body's fields as query parameters, so a
   link is named by what it says rather than by an id. A link that exists already is a
   `409`; one that does not exist is a `404`. People may add and remove
   `regression_of` links too (question 5).
8. **Who may link.** Linking needs `tasks:write` on both tasks, for people and for agents
   (question 3): a `worker_agent` marking a duplicate is the point. A restricted agent may
   link only tasks of its projects (`403` otherwise), and every task's `links` and
   `subtasks` leave out tasks outside the caller's projects, as lists already do (WT-05).
9. **History.** A parent change is a `field_changed` entry with field `parentId`, its
   values named as the activity names epics (`{ id, name }`, the name the task's key). A
   link adds `linked` and `unlinked` entry types, written on both tasks, each holding
   `{ type, direction, task: { id, key } }` as that task reads it. Triage's
   `regression_of` link gains its `linked` entries too.
10. **Live updates.** No new event type: a parent change sends `task.updated` for the
    sub-task, the old parent and the new parent; a link sends `task.updated` for both
    tasks, in each one's project stream. A board refreshes a card's progress when it gets
    the parent's event.
11. **Filters.** `parentId` joins the task filters of WT-08 decision 1: a task's id or key,
    or `none` for tasks that are not sub-tasks. Filtering by link is not added.
12. **The UI.** The task page gains a "Sub-tasks" section (each sub-task's key, title,
    status and assignee, the progress count, "Add sub-task" opening the create dialog with
    the parent set) and a "Links" section for every task (grouped by reading, "Add link"
    with a type and a task found through `GET /tasks?q=`, and "Remove"); the bug
    section's links move there. The details gain "Parent". A card shows its parent's key
    and, on a parent, `2/5` with its accessible name ("2 of 5 sub-tasks done"); the list
    view gains nothing new.
13. **Agents read and write all of it** with the scopes they have: `docs/agents.md` gains
    sub-tasks and links, and its doc check covers them.

## Proposed canonical changes

Not edited until approved, then applied by item F.

- **P1 — doc 0003 section 7, sub-tasks:** after "the parent shows a progress count", add:
  "A sub-task's epic is its parent's. A parent with sub-tasks cannot be deleted until they
  are deleted or detached; a sub-task restored after its parent was deleted becomes a
  normal task." (decisions 2 and 5)
- **P2 — doc 0003 section 7, links:** replace the paragraph on WT-06's table with: "Links
  are stored in `task_links`. People and agents holding `tasks:write` on both tasks add and
  remove links of every type; the triage pipeline also adds `regression of`. `relates to`
  is stored once. Every link added or removed is in the history of both tasks."
  (decisions 6, 8 and 9)
- **P3 — doc 0003 section 3:** the row "Comment; link tasks; apply labels; create new
  labels" loses "link tasks", which moves to "Create, edit, move and delete tasks and
  sub-tasks; link tasks", since linking needs `tasks:write` (decision 8, question 3).

## Work-items (outline)

Letters until each item starts; each gets its number on `main` when it starts, with its
work-spec.

| Item | Title                                                                                                         | Depends on |
| ---- | ------------------------------------------------------------------------------------------------------------- | ---------- |
| A    | Sub-tasks in the API: `parent_task_id`, its rules, epic sync, `parent`/`subtasks`, history, `parentId` filter | none       |
| B    | Links in the API: the four types, `POST` and `DELETE /tasks/{taskId}/links`, history on both, reach rules     | none       |
| C    | Sub-tasks in the UI: the section, "Add sub-task", "Parent", the card marks, live progress                     | A          |
| D    | Links in the UI: the "Links" section for every task, adding with a task search, removing                      | B          |
| E    | MCP tools for sub-tasks and links, if question 8 is answered so                                               | A, B       |
| F    | End-to-end flow, `docs/agents.md`, proposals P1 to P3, exit check                                             | C, D       |

A touches the tasks schema and service; B touches `task_links`, the task answer's
`links` and a new links service. Their shared file is the task answer, so B rebases on A
if A merges first; they can run in parallel.

## Exit criteria

- [ ] A Member makes a task a sub-task, and back, on create and on edit; each refusal of
      decision 1 is a `400` naming `parentId`; the history names who did it.
- [ ] A parent's answer, card and page show its sub-tasks and `done/total`, and a page open
      on the parent follows a sub-task's move with no reload.
- [ ] Changing a parent's epic changes its sub-tasks' epic; a sub-task's own `epicId` is a
      `400`; deleting a parent with live sub-tasks is a `409 has_subtasks`.
- [ ] A Member and a `worker_agent` each add and remove a link of each type across two
      projects; both tasks' answers, pages and histories show it; `relates_to` reads the
      same from both.
- [ ] A `qa_agent` (no `tasks:write`) cannot link; a restricted agent cannot link to, or
      see in `links` or `subtasks`, a task outside its projects.
- [ ] A Viewer reads everything this track adds and writes nothing; every new endpoint
      enforces its permission.
- [ ] `parentId` filters the board list, the backlog and the list across projects.
- [ ] The 100-item limits of decision 3 answer `409` with their codes.
- [ ] `docs/agents.md` and its doc check cover sub-tasks and links; the OpenAPI document
      describes them; doc 0003 carries the approved proposals.
- [ ] The full quality gate passes on `main`, with `pnpm db:generate` and
      `pnpm openapi:generate` leaving no diff.

## Risks and open questions

Questions for the owner, each with a recommendation:

1. **Deleting a parent that has sub-tasks.** Deleting them together needs a rule for
   restoring them together, and hides work someone else owns. **Recommend: refuse with
   `409 has_subtasks` (decision 5)**; the alternative is deleting the sub-tasks with it.
2. **A sub-task's epic.** Doc 0003 says a sub-task "belongs to its parent's project and
   epic". **Recommend: it always follows the parent's epic, copied and kept in step
   (decision 2)**, rather than letting a sub-task pick another epic.
3. **The permission to link.** Doc 0003 puts "link tasks" beside commenting, which a
   `qa_agent` holds, but a link changes how work is read, as an edit does. **Recommend:
   `tasks:write` (decision 8, P3)**; the alternative is `comments:write`, which would let
   a `qa_agent` mark duplicates.
4. **How `relates_to` is stored.** Stored twice, a removal must remove both rows.
   **Recommend: once, answered the same from both tasks (decision 6).**
5. **`regression of` by hand.** Triage writes it; a person may also know that a bug came
   back. **Recommend: people and agents with `tasks:write` may add and remove it**, and
   triage keeps adding it as today.
6. **Limits.** **Recommend: 100 sub-tasks per parent and 100 links per task (decision 3)**, raised by a work-item if a team needs more.
7. **Where links show.** Today they show only on bugs. **Recommend: a "Links" section on
   every task, and the bug section keeps its reports only (decision 12).**
8. **MCP tools.** An assistant would use `opanel_add_link` and sub-tasks on
   `opanel_create_task`. **Recommend: item E, inside this track**, since WT-11's tools
   already take every field of their endpoint's request schema: `parentId` arrives on the
   existing task tools on its own, and E adds `opanel_add_link` and `opanel_remove_link`.
   The alternative is a follow-up, as WT-08 did.
9. **Track order.** **Recommend: start A and B in parallel; then C and D (and E); F last.**

Risks:

- **Epic sync touches every sub-task of a parent** in one transaction: at most 100
  (decision 3), each with a history entry and an event.
- **A self-referencing foreign key and soft delete.** The one-level rule and the
  same-project rule are service checks; item A adds a check constraint against a task
  being its own parent and tests each refusal against a real database.
- **Reach rules on `links` change an existing answer** for restricted agents (decision 8):
  a link to a task outside the agent's projects stops showing. It shows no data the agent
  could otherwise read, so no client relies on it, but item B's work-spec records it.
- **History on two tasks per link** doubles writes for a link; links are rare next to
  edits.
