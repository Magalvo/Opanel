# WI-032 — Delete and restore a task

- Status: Approved
- Work-track: [WT-03](../work-tracks/WT-03-board-core.md) (decisions 4, 11, 12, 13)
- Depends on: WI-030
- Work-spec: [WS-032](../work-specs/WS-032-delete-and-restore-task.md)

## Outcome

Through the API, a Member deletes a task they reported and a Manager or Admin deletes any
task. Deletion is soft: the task disappears from every view and path, a Manager or Admin
can list a project's deleted tasks and restore one, and it comes back where it was. Both
are recorded in the task's history.

## Acceptance criteria

- [ ] `DELETE /api/v1/tasks/{taskId}` hides the task: it is gone from the list and its id
      and key answer `404`.
- [ ] A Member may delete only a task they reported (`403` otherwise); a Manager or Admin
      any task; a Viewer none.
- [ ] A Manager or Admin lists a project's deleted tasks (`deleted=true`) and restores one
      with `POST /api/v1/tasks/{taskId}/restore`; it returns to its column and place, with
      the same key. Members get `403` on both.
- [ ] Deleting and restoring each record one history event with the actor, and bump
      `version`.
- [ ] A column whose only tasks are deleted can be deleted; those tasks move to the
      project's first remaining column. A team stays undeletable while any task, deleted
      or not, is assigned to it.
- [ ] Every delete or restore in an archived project is `409 project_archived`.
- [ ] The full quality gate passes.
