# WI-102 — Priority and due date on tasks

- Status: Approved (by the owner on 2026-11-21, with WS-102)
- Work-track: [WT-07](../work-tracks/WT-07-backlog-priority-due-dates-labels.md) (item B)
- Depends on: [WI-101](WI-101-backlog-api.md) (same files; implemented after it merges)
- Work-spec: [WS-102](../work-specs/WS-102-priority-due-date.md)

## Outcome

Every task has a priority (`none`, `low`, `medium`, `high`, `urgent`; `none` by default)
and an optional due date (a calendar date). People and agents with `tasks:write` set and
clear them when creating or editing a task; each change is in the task's history and
reaches open boards as `task.updated`. The triage pipeline never sets priority.

## Acceptance criteria

- [ ] A migration adds `tasks.priority` (`text not null default 'none'`, checked) and
      `tasks.due_date` (`date`, nullable). Existing tasks answer `priority: "none"` and
      `dueDate: null`.
- [ ] `Task` and `TaskSummary` carry `priority` and `dueDate` (`YYYY-MM-DD` or `null`) in
      every answer: get, both lists, create, edit, move, restore, and a `409`'s `current`.
- [ ] `POST /projects/{projectId}/tasks` takes optional `priority` and `dueDate`;
      `PATCH /tasks/{taskId}` takes `priority` and `dueDate` (`null` clears the date), each
      alone being a valid change.
- [ ] An impossible date (`2026-02-30`), a date in another format, and the year `0000` are
      `400` naming `dueDate`; past dates are allowed.
- [ ] Each change of priority or due date is one `field_changed` history entry with the
      actor, old and new values; the version grows by one per `PATCH`.
- [ ] A bug created by the triage pipeline has priority `none`; a repeated report does not
      change a priority a person set.
- [ ] An agent with `tasks:write` sets priority and due date; a Viewer gets `403`.
- [ ] The OpenAPI document describes `Priority` and both fields; the full quality gate
      passes.

## Notes

WT-07 decisions 6 and 7, question 4. Showing priority and due date in the UI, and
"overdue", are item E; this item only keeps the UI's fixtures and types compiling.
