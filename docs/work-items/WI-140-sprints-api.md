# WI-140 — Sprints in the API

- Status: Proposed
- Work-track: [WT-10](../work-tracks/WT-10-sprints-and-story-points.md) (item B)
- Depends on: none (runs beside item A, story points)
- Work-spec: [WS-140](../work-specs/WS-140-sprints-api.md)

## Outcome

Through the API, a Manager turns sprints on and off for a project, and creates, reads,
edits and deletes its planned sprints. Every sprint change is in the audit log and reaches
open pages as a `sprint.changed` event. Tasks are not put into sprints yet (item C), and
sprints are not started or completed yet (item D), so nothing on the board or the backlog
changes (WT-10 decisions 3, 4, 8, 10 to 12).

## Acceptance criteria

- [ ] Every project answers `sprintsEnabled`, `false` by default; `PATCH /projects/{id}`
      with `sprintsEnabled` turns it on and off, needs `sprints:manage`, and writes
      `project.updated` in the audit log.
- [ ] `POST /projects/{projectId}/sprints` creates a planned sprint with a name, an
      optional goal and both dates; an end date before the start date is a `400` on
      `endDate`; a project without sprints answers `409 sprints_disabled`.
- [ ] `GET /projects/{projectId}/sprints` pages a project's sprints by start date, then
      creation, with a `state` filter; `GET /sprints/{sprintId}` answers one.
- [ ] `PATCH /sprints/{sprintId}` edits the name, goal and dates with `version`; a
      completed sprint is `409 sprint_completed`; a stale version is `409 version_conflict`.
- [ ] `DELETE /sprints/{sprintId}` deletes a planned sprint; any other state is
      `409 sprint_not_planned`.
- [ ] Turning sprints off while a sprint is active is `409 sprint_active` (checked against
      a sprint made active directly in the database, until item D).
- [ ] Creating, editing and deleting write `sprint.created`, `sprint.updated` and
      `sprint.deleted` in the audit log and send `sprint.changed` on the project stream
      (`version: null` on delete).
- [ ] Members, Viewers and agents read sprints and cannot write them (`403`); a restricted
      agent reads only its projects' sprints; an archived project's sprints are read-only.
- [ ] The OpenAPI document describes the endpoints, `Sprint`, the codes and the event;
      doc 0002 carries proposal P3; the full quality gate passes.

## Notes

- `tasks.sprint_id`, the `sprintId` field and filter, and the board and backlog rules are
  item C; sprint points, start and completion are item D; the UI is item E.
