# WI-031 — Move a task between and within columns

- Status: Proposed
- Work-track: [WT-03](../work-tracks/WT-03-board-core.md) (decisions 4, 5, 6, 7, 13)
- Depends on: WI-030
- Work-spec: [WS-031](../work-specs/WS-031-move-task.md)

## Outcome

Through the API, a Member moves a task to another column of its project or to another
place in the same column, by naming the task it should follow or precede. The move writes
one row, keeps every other task's place, and is recorded in the task's history when the
column changes. This is the operation the board's drag and drop (WI-037) will call.

## Acceptance criteria

- [ ] `POST /api/v1/tasks/{taskId}/move` places the task at the end of a column, or right
      after or right before a given task of that column; the list order follows.
- [ ] A move requires `version` and answers `409 version_conflict` with the current task
      when it is stale; any column of the same project may be the target (no workflow
      rules).
- [ ] Moving to another column records one `moved` event with the old and new column;
      reordering within a column records none.
- [ ] Concurrent moves and creations into the same column never produce the same
      position, and none of them fails because of another.
- [ ] Viewer gets `403`; every move in an archived project is `409 project_archived`.
- [ ] The full quality gate passes.
