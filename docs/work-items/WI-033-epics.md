# WI-033 — Epics

- Status: Done
- Work-track: [WT-03](../work-tracks/WT-03-board-core.md) (decisions 4, 7, 13, 16, 18)
- Depends on: WI-030
- Work-spec: [WS-033](../work-specs/WS-033-epics.md)

## Outcome

Through the API, a Manager or Admin creates an epic in a project, edits it, closes and
reopens it; every signed-in person lists a project's epics and reads one with its progress;
a Member puts a task in an epic of its project or takes it out. Epic changes go to the
audit log; a task's change of epic goes to its history.

## Acceptance criteria

- [x] An epic has a title, a Markdown description, a status (`open` or `closed`) and
      optional start and target dates (`YYYY-MM-DD`), the target not before the start.
- [x] A Manager or Admin creates, edits, closes and reopens epics; Viewer and Member get
      `403`. Edits require `version` and answer `409 version_conflict` when stale.
- [x] Every epic shows its progress: done tasks over all tasks, counting live tasks only, a
      task being done when its column is in the `done` category.
- [x] A task can be created in an epic and moved into or out of one with `PATCH`; the epic
      must belong to the task's project; each change records a `field_changed` event.
- [x] Every epic write in an archived project is `409 project_archived`.
- [x] Each epic change writes one audit entry with its actor, in the same transaction.
- [x] The full quality gate passes, with the migration committed.
