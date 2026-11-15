# WI-034 — Comments

- Status: Done
- Work-track: [WT-03](../work-tracks/WT-03-board-core.md) (decisions 4, 13, 14, 16, 19;
  question 2)
- Depends on: WI-030
- Work-spec: [WS-034](../work-specs/WS-034-comments.md)

## Outcome

Through the API, a Member, Manager or Admin comments on a task, and every signed-in person
lists a task's comments, oldest first. Comments are stored with a `kind` and a nullable
author from the start (decision 19), so the system comments of WT-06 need no redesign.
Each comment records a `commented` event in the task's history, in the same transaction.

## Acceptance criteria

- [x] A comment has a Markdown body (not blank, up to 10 000 characters, kept as written),
      a kind (`user` in this track), its author and its creation time.
- [x] `POST /api/v1/tasks/{taskId}/comments` needs `comments:write`: Members, Managers and
      Admins get `201`; a Viewer gets `403`. The task is found by id or key.
- [x] `GET /api/v1/tasks/{taskId}/comments` needs `tasks:read` and returns the comments
      oldest first, paginated with a cursor.
- [x] A deleted or unknown task is `404` for both; commenting in an archived project is
      `409 project_archived`.
- [x] Each comment writes exactly one `commented` history event pointing at it, with the
      author as actor, in the same transaction; a failure leaves neither.
- [x] Comments cannot be edited or deleted: there is no endpoint, and the database refuses
      updates and deletes.
- [x] The full quality gate passes, with the migration committed and the OpenAPI document
      regenerated.

## Notes

Editing and deleting comments is not planned (WT-03 question 2). Showing comments on the
task page is WI-038; the live `comment.created` event is WT-04; system comments are WT-06.
