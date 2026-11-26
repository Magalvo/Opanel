# WI-133 — Sub-tasks in the API

- Status: Approved (approved by the owner on 2026-11-26, with WS-133)
- Work-track: [WT-09](../work-tracks/WT-09-subtasks-and-links.md) (item A)
- Depends on: none (runs beside item B, links in the API)
- Work-spec: [WS-133](../work-specs/WS-133-subtasks-api.md)

## Outcome

Through the API, a task can be made a sub-task of another task of its project, one level
deep, and made a normal task again. A parent answers its sub-tasks and how many are done;
every task in a list says whose sub-task it is. A sub-task always has its parent's epic.
The rules of WT-09 decisions 1 to 5, 9 to 11 hold, every change is in the history, and
pages showing a parent or a sub-task hear about it.

## Acceptance criteria

- [ ] `parentId` on `POST /projects/{projectId}/tasks` and `PATCH /tasks/{taskId}` makes a
      task a sub-task (a task's id or key), and `parentId: null` makes it a normal task
      again.
- [ ] Each refusal of WT-09 decision 1 is a `400` on `parentId`: another project's task, a
      sub-task, a deleted task, the task itself, and a task that has sub-tasks becoming a
      sub-task.
- [ ] A sub-task's epic is its parent's: set with the parent, changed with the parent's, in
      the same transaction; an `epicId` that differs from the parent's in a write to a
      sub-task is a `400`.
- [ ] `TaskSummary` has `parent: { id, key, title } | null` and
      `subtasks: { done, total } | null`; `Task` has `subtasks`, the live sub-tasks in
      board order, then the backlog.
- [ ] Deleting a task with live sub-tasks is a `409 has_subtasks`; a 101st live sub-task is
      a `409 too_many_subtasks`; restoring a sub-task whose parent is deleted makes it a
      normal task.
- [ ] Setting or clearing a parent is a `field_changed` entry on `parentId`, its values
      named by the tasks' keys in the activity; epic changes made by the sync are entries
      on each sub-task.
- [ ] A write that changes a parent's sub-tasks sends `task.updated` for that parent.
- [ ] `parentId` filters the board list, the backlog and the list across projects: a task's
      id or key, or `none`.
- [ ] The OpenAPI document describes the new fields, codes and filter; the full quality
      gate passes.

## Notes

- The UI is item C; the MCP tools see `parentId` through their schemas and are item E.
