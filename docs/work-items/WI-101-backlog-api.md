# WI-101 — The backlog in the data model and API

- Status: Proposed
- Work-track: [WT-07](../work-tracks/WT-07-backlog-priority-due-dates-labels.md) (item A)
- Depends on: none
- Work-spec: [WS-101](../work-specs/WS-101-backlog-api.md)

## Outcome

A task can wait in its project's backlog instead of on the board: it has no column and a
place in the backlog order. People and agents with `tasks:write` create tasks there, move
them between the backlog and the board and reorder the backlog through the API; anyone with
`tasks:read` lists it. The board list, the triage pipeline and every read of a task treat a
backlog task correctly, and the web app keeps working when one exists.

## Acceptance criteria

- [ ] `tasks.column_id` is nullable; a migration adds a unique index on
      `(project_id, position)` for tasks with no column. Existing tasks keep their columns.
- [ ] `POST /projects/{projectId}/tasks` with `columnId: null` creates the task at the end
      of the backlog; without `columnId` it still goes to the end of the first column.
- [ ] `POST /tasks/{taskId}/move` with `columnId: null` moves a task to the backlog (at
      the end, or after or before a backlog task), reorders it within the backlog, and with
      a column id moves it back to the board. It checks `version`, writes one `moved`
      history entry when the task changes between the backlog and a column (or between
      columns), and sends `task.moved`.
- [ ] `GET /projects/{projectId}/backlog` (`tasks:read`) lists the backlog's live tasks in
      backlog order, paged with a keyset cursor.
- [ ] `GET /projects/{projectId}/tasks` lists only tasks with a column; with `deleted=true`
      it lists every deleted task, backlog tasks after the columns' tasks. A deleted backlog
      task is restored to its backlog place.
- [ ] Reading a task by id or key, editing, deleting, restoring and commenting work for a
      backlog task; its answers carry `columnId: null`.
- [ ] A bug report whose fingerprint matches an open bug in the backlog counts on it and
      creates no task.
- [ ] Epic progress counts a backlog task in its total and not as done.
- [ ] Concurrent creations and moves into one backlog never produce the same position.
- [ ] The board removes a task that moves to the backlog, and the task detail of a backlog
      task says "In backlog" and can move it to a column.
- [ ] The OpenAPI document describes the nullable `columnId` and the new endpoint; the full
      quality gate passes.

## Notes

WT-07 decisions 1 to 5. The Backlog page is item D; priority, due dates and labels are
items B and C.
