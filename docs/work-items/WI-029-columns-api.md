# WI-029 — Columns API

- Status: Done
- Work-track: [WT-03](../work-tracks/WT-03-board-core.md) (decisions 4, 5, 7, 10, 16)
- Depends on: WI-028
- Work-spec: [WS-029](../work-specs/WS-029-columns-api.md)

## Outcome

Through the API, every signed-in person reads a project's columns in board order, and a
Manager or Admin adds, renames, recategorises, reorders and deletes them. A project always
keeps at least one `done` column. Every change is audited and follows the concurrency
rules of WT-03.

## Acceptance criteria

- [x] `GET /api/v1/projects/{projectId}/columns` returns all of a project's columns, in
      board order, to every human role.
- [x] A Manager or Admin adds a column at the end or after a given column, renames it,
      changes its category, moves it, and deletes it; Viewer and Member get `403`.
- [x] Deleting or recategorising the last `done` column is `409 last_done_column`.
- [x] Renaming, recategorising and moving require `version`; a stale one is
      `409 version_conflict` with the current column.
- [x] Every write in an archived project is `409 project_archived`.
- [x] Concurrent column changes in one project are serialised, so the `done` rule and the
      order hold under concurrency.
- [x] Each change writes one audit entry with its actor, in the same transaction.
- [x] The full quality gate passes.

## Notes

Decision 10's rule that a non-empty column cannot be deleted is enforced from WI-030,
which creates the tasks table and its reference to columns.
