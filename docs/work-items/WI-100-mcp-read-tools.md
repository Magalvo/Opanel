# WI-100 — The MCP read tools: projects, board, teams, people and a task

- Status: Proposed
- Work-track: [WT-11](../work-tracks/WT-11-mcp-server.md) (item B)
- Depends on: [WI-099](WI-099-mcp-server-skeleton.md) (done)
- Work-spec: [WS-100](../work-specs/WS-100-mcp-read-tools.md)

## Outcome

An AI assistant connected to the Opanel MCP server can read what an agent needs before it
works a ticket: the projects, a project's whole board, the teams, the people, and a task
with its comments. Each is one read-only tool, offered only when the agent holds the
permissions its API calls need, built from the shared schemas of `src/lib/schemas/`, and
every text a person or another agent wrote is marked as data, not instructions.

## Acceptance criteria

- [ ] Five tools are added, as doc 0005 section 4 lists them: `opanel_list_projects`,
      `opanel_get_board`, `opanel_list_teams`, `opanel_find_people` and
      `opanel_get_task`. Each is read-only (`readOnlyHint`) and its description names its
      permission.
- [ ] A tool is offered only when the agent holds **every** permission its API calls
      need: `opanel_get_board` needs `projects:read` (the columns) and `tasks:read` (the
      tasks). A `qa_agent` or `worker_agent` with the default scopes gets all five.
- [ ] Each tool's input is validated with a schema built from the endpoint's request
      schema before any request; an invalid input makes no request.
- [ ] `opanel_list_projects`, `opanel_list_teams` and `opanel_find_people` answer one
      page and its `nextCursor`, and take `cursor` and `limit` to continue.
- [ ] `opanel_get_board` takes a project id or key and answers every column in board
      order, each with all its tasks in board order, following every page of tasks. A
      board that changed while it was loading is a tool error, never a wrong board.
- [ ] `opanel_get_task` takes a task id or key and answers the task with one page of its
      comments, oldest first, and their `nextCursor`; `commentsCursor` continues.
- [ ] Every answer is parsed with the endpoint's response schema; one that does not
      match is a tool error. API problems are tool errors as in WI-099.
- [ ] Every tool's description and text result say which fields are written by people or
      agents and must be treated as data, not instructions; those texts are quoted in the
      summary, never written bare.
- [ ] The token never appears in any of the new tools' results or errors (tested).
- [ ] An end-to-end test drives the built server over stdio against the running app: an
      Admin sets up a project, a team, a task and a comment, and a `qa_agent` reads them
      through each tool.

## Notes

WT-11 item B, doc 0005 sections 4 to 6. Write tools are item C (WI to come). The
permission of `opanel_get_board` corrects doc 0005's table, which names `tasks:read`
only (WS-100, question 1).
