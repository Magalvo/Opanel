# WI-141 — Tasks in sprints

- Status: Done (approved by the owner on 2026-11-27, with WS-141; done on 2026-11-27)
- Work-track: [WT-10](../work-tracks/WT-10-sprints-and-story-points.md) (item C)
- Depends on: WI-140 (sprints in the API), done
- Work-spec: [WS-141](../work-specs/WS-141-tasks-in-sprints.md)

## Outcome

Through the API, a task belongs to at most one sprint of its project. In a project with
sprints, a live task has a column exactly while its sprint is active or completed (WT-10
decision 5): the board lists the active sprint's tasks only; moving a task onto the board
puts it in the active sprint and moving it to the backlog takes it out; a new task goes to
the backlog unless it is created in a column; sub-tasks follow their parent's sprint.
Projects without sprints keep today's board and backlog exactly. Every sprint change is in
the history and reaches open pages.

## Acceptance criteria

- [x] Every task answer has `sprint: { id, name, state } | null`; `sprintId` on create and
      `PATCH` sets it, `null` clears it; a sprint of another project, a completed sprint or
      an unknown one is a `400` on `sprintId`.
- [x] In a project with sprints, `GET /projects/{projectId}/tasks` lists only the active
      sprint's tasks, and nothing when no sprint is active; the backlog lists every task
      with no column, planned-sprint tasks included.
- [x] Moving a task into a column adds it to the active sprint (`409 no_active_sprint`
      when there is none); moving it to the backlog takes it out; `sprintId` set to the
      active sprint puts the task at the bottom of the first column, to a planned sprint
      or `null` puts it at the end of the backlog.
- [x] Creating a task with a `columnId` in a project with sprints joins the active sprint;
      without one, the task goes to the end of the backlog, unscheduled.
- [x] A sub-task's sprint is its parent's: copied when the parent is set, kept in step when
      the parent's sprint changes; a differing `sprintId` in a write is a `400`; moving a
      sub-task off the board while its parent is in the active sprint, or onto it while its
      parent is not, is `409 subtask_follows_parent`.
- [x] A task of a completed sprint cannot be given another sprint (`409 sprint_completed`);
      moving it takes it out of the record.
- [x] Deleting a planned sprint makes its tasks unscheduled, each with a history entry.
- [x] In a project without sprints, a non-null `sprintId` is `409 sprints_disabled`, and
      every existing board and backlog test passes unchanged.
- [x] A new agent-filed bug in a project with sprints lands at the top of the backlog,
      unscheduled (if question 1 is answered so).
- [x] A sprint change is a `field_changed` entry on `sprintId`, named after who made it,
      with the sprint's name in the activity; it sends `task.updated` or `task.moved`.
- [x] `sprintId` (a sprint's id, `none` or `active`) filters the board list, the backlog
      and the list across projects.
- [x] The OpenAPI document describes the field, the filter and the codes; `docs/agents.md`
      names the filter; the full quality gate passes.

## Notes

- Starting and completing sprints, "Sprint 1" on turning sprints on and sprint points are
  item D; the UI is items E and F.
