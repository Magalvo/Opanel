# WI-139 — Story points

- Status: Done (approved by the owner on 2026-11-27, with WS-139; done on 2026-11-27)
- Work-track: [WT-10](../work-tracks/WT-10-sprints-and-story-points.md) (item A)
- Depends on: none (runs beside item B, sprints in the API)
- Work-spec: [WS-139](../work-specs/WS-139-story-points.md)

## Outcome

Any task can carry story points, set and cleared by people and agents with `tasks:write`,
through the API and on the task page. Every task answer has them, a card shows them, the
list view sorts by them, and every change is in the history. An epic shows its done and
total points beside its task count, and how many of its tasks are not estimated (WT-10
decisions 1 and 2).

## Acceptance criteria

- [x] `storyPoints` on `POST /projects/{projectId}/tasks` and `PATCH /tasks/{taskId}` sets
      a task's points; `storyPoints: null` on `PATCH` clears them. A value below 0, above
      999.5 or not a multiple of 0.5 is a `400` on `storyPoints`.
- [x] Every task answer (`TaskSummary`, `Task`, `TaskListItem`) has
      `storyPoints: number | null`.
- [x] A change is a `field_changed` entry on `storyPoints`, named after who made it, and
      the timeline reads it ("changed the story points from 3 to 5").
- [x] The list across projects sorts by `storyPoints` both ways, tasks with none last; the
      list view's "Points" header sorts by it.
- [x] An epic's `progress` has `donePoints`, `totalPoints` and `unestimated`; sub-tasks
      count; deleted tasks do not; done means in a `done` column.
- [x] The task page shows "Story points" and edits them; a card shows a task's points when
      it has some, with an accessible name; an epic shows its points beside its tasks.
- [x] A Viewer reads points and cannot set them; a `qa_agent` cannot set them (`403`).
- [x] `docs/agents.md` names the field and the sort; the OpenAPI document describes them;
      the full quality gate passes.

## Notes

- Sprint totals are item D's; they reuse the sums this item adds to epics.
- The MCP task tools take `storyPoints` through their schemas, as they took `parentId`.
