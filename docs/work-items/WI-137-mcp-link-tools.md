# WI-137 — MCP tools for links, sub-tasks on the task tools

- Status: Done (approved by the owner on 2026-11-27, with WS-137; done on 2026-11-27)
- Work-track: [WT-09](../work-tracks/WT-09-subtasks-and-links.md) (item E)
- Depends on: [WI-133](WI-133-subtasks-api.md) and [WI-134](WI-134-links-api.md) (items A
  and B, done)
- Work-spec: [WS-137](../work-specs/WS-137-mcp-link-tools.md)

## Outcome

An AI assistant connected through the MCP server links and unlinks tasks, and works with
sub-tasks, as its agent account. `opanel_add_link` and `opanel_remove_link` are offered to
agents holding `tasks:write`. The task tools say how to make a task a sub-task, and
`opanel_get_task` names a task's parent, its sub-tasks' progress and its links.

## Acceptance criteria

- [x] `opanel_add_link` takes `taskId`, `type`, `direction` and `otherTaskId` (each task by
      id or key), sends `POST /tasks/{taskId}/links`, and answers the task with a summary
      such as "Linked: OPA-1 blocks API-3. Its version is now 5." (WS-137 deviation 1).
- [x] `opanel_remove_link` takes the same input, sends `DELETE /tasks/{taskId}/links` with
      the link as query parameters, then reads the task. It answers the task with "Removed
      the link: OPA-1 blocks API-3. Its version is now 6.".
- [x] Both are offered only to agents holding `tasks:write` and `tasks:read`, so a
      `worker_agent` gets them and a `qa_agent` does not. Their descriptions name those
      permissions. `opanel_remove_link` is marked `destructiveHint`.
- [x] The API's refusals are tool errors with their status and code: `link_exists`,
      `too_many_links`, `403`, `404`, a `400` on `taskId`, and `project_archived`. When
      Opanel does not answer, the error says the change may have been made.
- [x] `opanel_create_task` and `opanel_update_task` say that `parentId` makes the task a
      sub-task, and that `null` (update only) detaches it. Their input already takes it.
- [x] `opanel_get_task`'s summary names the parent ("a sub-task of OPA-9"), the progress
      ("2 of 5 sub-tasks done") and the number of links.
- [x] `mcp/README.md`, `docs/mcp.md` and doc 0005 section 4 list the two tools. The guide
      check passes.
- [x] An end-to-end test drives the built server as a `worker_agent`: it links two tasks
      of two projects, reads the link from both tasks, removes it, and makes a task a
      sub-task.
- [x] The full quality gate passes.

## Notes

- No API change.
