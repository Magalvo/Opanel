# WI-134 — Links in the API

- Status: Done (approved by the owner on 2026-11-26, with WS-134; done on 2026-11-26)
- Work-track: [WT-09](../work-tracks/WT-09-subtasks-and-links.md) (item B)
- Depends on: WT-06 (the `task_links` table, WS-086 and WS-090) and WT-08 (the activity
  endpoint and timeline, WS-117 and WS-119), both done. Runs in parallel with item A
  ([WI-133](WI-133-subtasks-api.md)).
- Work-spec: [WS-134](../work-specs/WS-134-links-api.md)

## Outcome

People and agents holding `tasks:write` link any two tasks they may reach, across projects,
as blocking, duplicating, a regression of, or related to each other, and remove the link
again, through `POST` and `DELETE /api/v1/tasks/{taskId}/links`. Both tasks' answers list
the link, read from each side; both histories record who added or removed it, the triage
pipeline's `regression_of` link included; and a page open on either task follows the change
live. A restricted agent links only tasks of its projects and no longer sees, in a task's
`links`, a task outside them.

## Acceptance criteria

- [x] `task_links` allows the types `blocks`, `duplicates`, `regression_of` and
      `relates_to`; `relates_to` is stored once, from the task with the lower id, and the
      database refuses it the other way round.
- [x] `POST /tasks/{taskId}/links` with `{ type, direction, taskId }` adds a link and
      answers `200` with the task; `DELETE /tasks/{taskId}/links?type=&direction=&taskId=`
      removes it and answers `204`. Either task may name the link, and `relates_to` reads
      `outgoing` from both.
- [x] A link that exists already is a `409 link_exists`; one that does not is a `404`; a
      missing or deleted other task, or the task itself, is a `400` on `taskId`; a task in
      an archived project is a `409 project_archived`.
- [x] Both need `tasks:write` and access to both tasks' projects: a Viewer and a
      `qa_agent` get `403`, a Member and a `worker_agent` succeed, and a restricted agent
      gets `403` for a task outside its projects.
- [x] A task holds at most 100 links: the 101st, on either side, is a
      `409 too_many_links`. The triage pipeline's link is never refused.
- [x] Each link added or removed writes a `linked` or `unlinked` history entry on both
      tasks, as each reads it, with the acting account; the triage pipeline's
      `regression_of` link writes `linked` on both too.
- [x] Each link added or removed bumps both tasks' `version` and sends `task.updated` for
      each, in its own project's stream; a refused request writes and sends nothing.
- [x] A task's `links` leave out tasks outside the caller's projects (a change to the
      existing answer for restricted agents, recorded in the work-spec).
- [x] `GET /tasks/{taskId}/activity` answers the new entries, and the timeline writes a
      sentence for each; the bug section shows only `regression_of` links until item D
      gives every task a "Links" section.
- [x] The OpenAPI document describes both operations; `pnpm db:generate` and
      `pnpm openapi:generate` leave no diff.
- [x] The full quality gate passes.

## Notes

- No UI to add or remove links: that is item D. No MCP tools: item E.
- Item A changes the `tasks` table, the task answer and the tasks service at the same time;
  whichever of A and B merges second rebases and regenerates its migration (`AGENTS.md`
  section 8).
