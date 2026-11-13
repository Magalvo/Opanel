# WI-030 — Tasks core

- Status: Done
- Work-track: [WT-03](../work-tracks/WT-03-board-core.md) (decisions 3, 7, 8, 9, 10, 11, 13, 16)
- Depends on: WI-026, WI-029
- Work-spec: [WS-030](../work-specs/WS-030-tasks-core.md)

## Outcome

Through the API, a Member creates tasks in a project, reads one by its id or its key
(`OPA-12`), lists a project's tasks in board order, edits a task's title, description and
type, and assigns it to a team, a person, both or neither. Every change to a task is
recorded as a history event in the same transaction. Teams with tasks and columns with
tasks can no longer be deleted.

## Acceptance criteria

- [x] Each new task gets the key `<project key>-<n>`, with `n` counting up from 1 per
      project, with no gap or duplicate under concurrent creation; keys never change.
- [x] A task is created in the project's first column by default, or in a given column of
      the same project, at the end of that column.
- [x] `GET /api/v1/tasks/{taskId}` accepts the id or the key; the project's task list comes
      in board order (column order, then task order) with keyset pagination.
- [x] `PATCH` changes title, description, type and assignment, requires `version`, and
      answers `409 version_conflict` with the current task when it is stale.
- [x] Only an existing team and an active person can be newly assigned; a deactivated
      assignee stays visible as inactive.
- [x] Creating a task records a `created` event; each changed field records one
      `field_changed` event with old and new value; events and change commit together,
      and events cannot be changed or deleted.
- [x] Viewer gets `403` on create and edit; Members and above may; every write in an
      archived project is `409 project_archived`.
- [x] Deleting a team assigned to a task is `409 team_in_use`; deleting a column that holds
      a task is `409 column_not_empty`.
- [x] The full quality gate passes, with the migrations committed.
