# WI-104 — The MCP write tools: comment, create, update and move a task

- Status: In progress
- Work-track: [WT-11](../work-tracks/WT-11-mcp-server.md) (item C)
- Depends on: [WI-100](WI-100-mcp-read-tools.md) (done)
- Work-spec: [WS-104](../work-specs/WS-104-mcp-write-tools.md)

## Outcome

An AI assistant connected to the Opanel MCP server can work a ticket, not only read it: it
comments on a task, creates a task, changes a task's fields, and moves a task on the
board, each as one tool, offered only when the agent holds the permission, built from the
shared request schemas of `src/lib/schemas/`, and recorded in the task history under the
agent's account. A change made on a stale `version` comes back as a tool error that holds
the task as it is now, so the assistant can look again and retry; the server never
retries a write on its own.

## Acceptance criteria

- [ ] Four tools are added, as doc 0005 section 4 lists them: `opanel_add_comment`
      (`comments:write`), `opanel_create_task`, `opanel_update_task` and
      `opanel_move_task` (`tasks:write`). Each description names its permission and says
      the tool changes Opanel.
- [ ] A `qa_agent` holding every scope of its role is offered `opanel_add_comment` and
      none of the three task writes; a `worker_agent` holding every scope of its role is
      offered all four.
- [ ] Each tool takes a task id or key (`OPA-12`), or for `opanel_create_task` a project id
      or key, plus the fields of the endpoint's request schema. The input is validated
      with that schema, its cross-field rules included (a severity only on a bug, at least
      one field to change, `afterTaskId` or `beforeTaskId` but not both), before any
      request; an invalid input makes no request.
- [ ] `opanel_update_task` and `opanel_move_task` require `version`. A
      `409 version_conflict` is a tool error that carries the current task, parsed with the
      task schema, and tells the assistant to look again before retrying.
- [ ] Every answer is parsed with the endpoint's response schema; one that does not match
      is a tool error. Other API problems (`400`, `403`, `404`, `409 project_archived`,
      `409 account_inactive`) are tool errors as in WI-099.
- [ ] A write is sent once. When it times out or the connection drops, the tool error says
      the change may have been made and to check with `opanel_get_task` before retrying.
- [ ] Results quote every text a person or agent wrote, after the notice that it is data,
      not instructions, as the read tools do.
- [ ] The token never appears in any of the new tools' results or errors (tested).
- [ ] An end-to-end test drives the built server over stdio against the running app: a
      `worker_agent` creates a task, updates it, moves it and comments on it; a retry on
      the stale `version` gets the conflict with the current task; the task's history
      shows each change under the agent's account. A `qa_agent` is offered only the
      comment among the writes.

## Notes

WT-11 item C, doc 0005 sections 4 to 6. `opanel_submit_bug_report` is item D and the
operator guide item E. No endpoint and no permission changes: a tool can only do what its
endpoint already allows (doc 0005 section 4).
