# WI-142 — Starting and completing sprints

- Status: Done (approved by the owner on 2026-11-27, with WS-142; done on 2026-11-28)
- Work-track: [WT-10](../work-tracks/WT-10-sprints-and-story-points.md) (item D)
- Depends on: WI-139 (story points) and WI-141 (tasks in sprints), both done
- Work-spec: [WS-142](../work-specs/WS-142-sprint-start-complete.md)

## Outcome

Through the API, a Manager starts a planned sprint, which puts its tasks on the board, and
completes the active sprint, which keeps its done work as the sprint's record and sends the
rest to the next planned sprint or the backlog. A sprint answers its tasks and points,
frozen when it completes. Turning sprints on for a project whose board holds tasks makes
them an active "Sprint 1", so nothing disappears (WT-10 decisions 6 and 7, and the points
of decision 8).

## Acceptance criteria

- [x] `POST /sprints/{sprintId}/start` with `version` starts a planned sprint: its live
      tasks go to the bottom of the first column in their backlog order, each with a
      `moved` entry named after the Manager and a `task.moved` event.
- [x] Starting answers `409 sprint_active` while another sprint is active,
      `409 sprint_not_planned` for a sprint that is not planned, `409 sprints_disabled` in
      a project without sprints, `409 version_conflict` for a stale version.
- [x] `POST /sprints/{sprintId}/complete` with `moveUnfinishedTo` (a planned sprint of the
      project, or `null`) and `version` completes the active sprint: done work stays
      attached in its column; unfinished work leaves its column for that sprint or the
      backlog, at the top, in board order, with history entries and events.
- [x] Sub-tasks stay with their parent through a completion: a parent decides where its
      sub-tasks go (question 1).
- [x] Completing answers `409 sprint_not_active` for a sprint that is not active and a `400`
      on `moveUnfinishedTo` for a sprint that is not a planned sprint of the project.
- [x] Every sprint answers `progress` (tasks and points, done and total, and tasks not
      estimated); a completed sprint's progress is frozen at completion.
- [x] Turning sprints on for a project whose board has live tasks creates "Sprint 1",
      active, from today to 14 days later, holding exactly those tasks; the board lists the
      same tasks before and after. With an empty board, no sprint is created.
- [x] Start, completion and "Sprint 1" write `sprint.started`, `sprint.completed` and
      `sprint.created` in the audit log and send `sprint.changed`.
- [x] Members, Viewers and agents cannot start or complete (`403`).
- [x] The OpenAPI document describes both endpoints, `progress` and the new code; the full
      quality gate passes.

## Notes

- The backlog's "Start sprint" and the board's "Complete sprint" are item E; agent-filed
  bugs moved to item C (WS-141 deviation 3).
