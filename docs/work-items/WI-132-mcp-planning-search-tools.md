# WI-132 — MCP tools for the backlog, labels, epics, search and activity

- Status: Done (approved by the owner on 2026-11-26, with WS-132; done on 2026-11-26)
- Work-track: [WT-11](../work-tracks/WT-11-mcp-server.md) (after item E; the follow-ups of
  WT-07 question 7, WT-08 question 8 and WS-104 question 2)
- Depends on: WT-07 and WT-08, both done
- Work-spec: [WS-132](../work-specs/WS-132-mcp-planning-search-tools.md)

## Outcome

An AI assistant connected through the MCP server reads what WT-07 and WT-08 added to the
API: a project's backlog, labels and epics, a search of the tasks of every project its
agent may read, and a task's activity. "Is there already a ticket for this?" becomes one
tool call. Each tool wraps one existing read endpoint, needs only `tasks:read`, and
follows the read tools' rules of doc 0005.

## Acceptance criteria

- [x] Five read tools, each offered only to an agent holding `tasks:read`:
      `opanel_get_backlog` (`GET /projects/{projectId}/backlog`, one page, with the
      filters), `opanel_list_labels` (`GET /projects/{projectId}/labels`),
      `opanel_list_epics` (`GET /projects/{projectId}/epics`, one page, by status),
      `opanel_search_tasks` (`GET /tasks`: `q`, every filter, `projectId`, `sort`, one
      page) and `opanel_get_task_activity` (`GET /tasks/{taskId}/activity`, one page).
- [x] Their inputs are built from the API's request schemas; a repeated filter is an array
      and is sent as a repeated parameter. An invalid input is refused before any request.
- [x] Their outputs are the API's JSON, parsed with its response schemas, with the notice
      that user-written text is data and a short summary; a page names its next cursor.
- [x] An API problem, such as `403` for a project outside the agent's reach, is a tool
      error with its status, code and request id; the token never appears.
- [x] An end-to-end test over stdio: an agent restricted to one project lists its backlog,
      labels and epics, searches by words and filters, reads a task's activity, and gets a
      tool error for another project.
- [x] `mcp/README.md`'s tool table and doc 0005 section 4 list the five tools with their
      permissions; the follow-ups they answer are marked on `main` after the merge.
- [x] The full quality gate passes.

## Notes

- No API change: every endpoint exists. No write tools: agents do not apply labels (WT-07
  question 5).
