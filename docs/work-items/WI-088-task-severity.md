# WI-088 — Severity on tasks

- Status: Approved (2026-11-20)
- Work-track: [WT-06](../work-tracks/WT-06-bug-reports-and-triage.md) (item C)
- Depends on: WI-086 (done)
- Work-spec: [WS-088](../work-specs/WS-088-task-severity.md)

## Outcome

Every task the API returns carries its bug fields: `severity`, `fingerprint`,
`occurrences` and `lastReportedAt`. A person or agent with `tasks:write` sets, changes or
clears a bug's severity when creating or editing it, and each change is in the task
history. Only bugs have a severity: a task that stops being a bug loses it. The pipeline
(item D) is the only writer of the other three fields.

## Acceptance criteria

- [ ] `Task` and `TaskSummary` (task `GET`, lists, create, edit, move, restore, the
      `current` of a version conflict) carry `severity` (`low | medium | high | critical`
      or `null`), `fingerprint` (string or `null`), `occurrences` (integer, 0 or more) and
      `lastReportedAt` (date-time or `null`); a task created as before answers `null`,
      `null`, `0`, `null`.
- [ ] `POST /projects/{projectId}/tasks` accepts an optional `severity` when `type` is
      `bug`; `PATCH /tasks/{taskId}` accepts `severity`, and `null` clears it.
- [ ] A severity on a task that is not, or will not be, a bug is a `400` naming
      `severity`.
- [ ] Changing a bug's type to `task` or `story` clears its severity in the same write;
      changing a task's type to `bug` leaves its severity `null`.
- [ ] Every change of severity, including the one a type change makes, is a
      `field_changed` entry of the task history with the actor, old and new value; a
      creation with a severity records it in the `created` entry.
- [ ] `fingerprint`, `occurrences` and `lastReportedAt` are refused in both request
      bodies (`400`, as any unknown field).
- [ ] The OpenAPI document describes the new fields and the new request field; the full
      quality gate passes.

## Notes

WT-06 decision 1 and question 7. Showing and editing severity in the UI is item F; the
pipeline that writes the other three fields is item D.
