# WI-034 — Comments

- Status: Proposed (awaiting owner approval)
- Work-track: [WT-03](../work-tracks/WT-03-board-core.md) (decisions 12, 13, 14, 16, 19)
- Depends on: WI-030
- Work-spec: [WS-034](../work-specs/WS-034-comments.md)

## Outcome

Through the API, a Member, Manager or Admin writes a comment on a task, and every
signed-in person lists a task's comments, oldest first. A comment records who wrote it and
when, and its creation is one entry in the task's history, written in the same transaction.
Comments have a `kind` and a nullable author from the start (decision 19), so the triage
pipeline of WT-06 can add system comments without a redesign. Only `user` comments exist in
this track, and they cannot be edited or deleted.

## Acceptance criteria

- [ ] A comment has a Markdown body (1 to 10 000 characters, kept as written), a `kind`
      (`user`), an author and a creation time.
- [ ] Member, Manager and Admin create comments; Viewer gets `403`. Every signed-in person
      lists them. No request edits or deletes a comment.
- [ ] A task's comments are listed oldest first, in pages, with a cursor that never repeats
      or skips a comment.
- [ ] Creating a comment writes one `commented` event in the task's history, with the
      author as actor and the comment id as its value, in the same transaction; if the
      event cannot be written, no comment exists.
- [ ] A comment does not change the task's `version`, so it never makes a concurrent edit of
      the task answer `409`.
- [ ] A deleted task, an unknown task and a task of an archived project: `404` on reads of
      a deleted or unknown task, and `409 project_archived` on creating a comment in an
      archived project.
- [ ] The database refuses a `user` comment without an author.
- [ ] The full quality gate passes, with the migration committed.
