# WS-132 — MCP tools for the backlog, labels, epics, search and activity

- Status: Approved (approved by the owner on 2026-11-26, questions 1 to 3 as recommended)
- Work-item: [WI-132](../work-items/WI-132-mcp-planning-search-tools.md)
- Canonical docs: [0005](../canonical/0005-mcp-server.md) sections 4 (the tools, "new
  tools are added by work-items"), 5 (inputs, outputs, errors) and 6 (data, not
  instructions); [WS-100](WS-100-mcp-read-tools.md) (the read tools' rules);
  [WT-07](../work-tracks/WT-07-backlog-priority-due-dates-labels.md) question 7,
  [WT-08](../work-tracks/WT-08-search-filters-list-timeline.md) question 8 and
  [WS-104](WS-104-mcp-write-tools.md) question 2 (the follow-ups this answers)

## Approach

### 1. Starting point, checked against `main` (`a4e85d8`)

- `mcp/src/tools.ts` lists eleven tools; `offeredTools` keeps those whose `permissions`
  the agent holds. Each read tool (`mcp/src/tools/*.ts`) builds its input from a schema of
  `src/lib/schemas/`, calls one endpoint through `api.get` with its response schema, and
  answers `readResult(summary, value, redact)`: the notice, a summary, the JSON.
- `query()` in `tools/results.ts` writes one value per parameter; no tool sends a repeated
  parameter yet.
- The endpoints exist and each needs `tasks:read` alone: `GET /projects/{projectId}/backlog`
  (`backlogQuerySchema`: the page and the filters), `GET /projects/{projectId}/labels`
  (every label, `labelListSchema`), `GET /projects/{projectId}/epics` (`epicQuerySchema`:
  the page and `status`), `GET /tasks` (`allTasksQuerySchema`: the page, the filters,
  `projectId`, `sort`) and `GET /tasks/{taskId}/activity` (`activityQuerySchema`).
- The SDK (2.4.0) turns a tool's Zod input into JSON Schema with `io: "input"`. Checked on
  this branch: the filters' `oneOrMany` (a value or an array, then a transform) becomes an
  `anyOf` of the value and the array, so the tools can take the API's own filter fields.
- `mcp/src/guide.test.ts` checks that `mcp/README.md`'s tool table lists every tool, in
  order, with its permissions.

### 2. The tools

All five are read tools as WS-100 defines them: `READ_ONLY` annotations, a description that
names `tasks:read` and ends with `DATA_NOT_INSTRUCTIONS`, `outputSchema` the response
schema, and the API's problems as tool errors.

| Tool                       | Input                                                                                             | Call                                |
| -------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `opanel_get_backlog`       | `projectId`, the filters of `backlogQuerySchema`, `limit`, `cursor`                               | `GET /projects/{projectId}/backlog` |
| `opanel_list_labels`       | `projectId`                                                                                       | `GET /projects/{projectId}/labels`  |
| `opanel_list_epics`        | `projectId`, `status` (`open` by default, `closed`, `all`), `limit`, `cursor`                     | `GET /projects/{projectId}/epics`   |
| `opanel_search_tasks`      | `q`, the filters, `projectId` (one or several), `sort` (`-updated` by default), `limit`, `cursor` | `GET /tasks`                        |
| `opanel_get_task_activity` | `taskId` (id or key), `limit`, `cursor`                                                           | `GET /tasks/{taskId}/activity`      |

**Inputs.** Each is a strict object of the request schema's fields, with `limit` replaced
by `limitSchema`, as WS-100 does, and the due-date order refinement kept. A filter takes a
value or an array of up to 20 (the API's `oneOrMany`). `projectId` is a project's id or key,
`taskId` a task's id or key.

**The query string.** `query()` gains arrays: each value of an array is appended as its own
parameter, in order, so `{ priority: ["high", "urgent"] }` sends
`priority=high&priority=urgent`. The parsed input is written back as the API reads it, field
by field in the input's order.

**Summaries**, after the notice, each followed by `more(...)` when there is a next page:

- backlog: `3 tasks in the backlog, in rank order: OPA-4, a task: "Logout button"; …`;
- labels: `2 labels: "release", "ui".`;
- epics: `1 open epic: "Launch".` (or closed, or epics for `all`);
- search: `2 tasks: OPA-1, a bug: "Login fails" (OPA, In progress); WEB-3, … (WEB, backlog).`;
- activity: `5 items, oldest first: 3 changes and 2 comments.`

**Order in the list.** The project reads, then the task reads (question 1):
`opanel_whoami`, `opanel_list_projects`, `opanel_get_board`, `opanel_get_backlog`,
`opanel_list_labels`, `opanel_list_epics`, `opanel_list_teams`, `opanel_find_people`,
`opanel_search_tasks`, `opanel_get_task`, `opanel_get_task_activity`, then the writes as
today.

### 3. Docs

- `mcp/README.md`: the five rows in the tool table, in the order above.
- Doc 0005 section 4: the five rows in its table, and "first set" becomes "the tools";
  its "Amended by" line names this work-item. Section 4 already says new tools are added
  by work-items and need no new permission.
- `docs/mcp.md`, "What the assistant gets": a `qa_agent` also searches tasks and reads the
  backlog, labels, epics and a task's activity.
- After the merge, an index commit on `main` marks the three follow-ups answered.

## Files

| Path                                                    | Change                                    |
| ------------------------------------------------------- | ----------------------------------------- |
| `mcp/src/tools/backlog.ts`                              | create: `opanel_get_backlog`              |
| `mcp/src/tools/labels.ts`                               | create: `opanel_list_labels`              |
| `mcp/src/tools/epics.ts`                                | create: `opanel_list_epics`               |
| `mcp/src/tools/search.ts`                               | create: `opanel_search_tasks`             |
| `mcp/src/tools/activity.ts`                             | create: `opanel_get_task_activity`        |
| `mcp/src/tools/results.ts`                              | modify: `query()` takes arrays            |
| `mcp/src/tools.ts`                                      | modify: the five tools, in order          |
| `mcp/src/planning-search-tools.test.ts`                 | create: tests 1 to 8                      |
| `mcp/src/read-tools.test.ts`, `mcp/src/tools.test.ts`   | modify: the offered lists and their order |
| `mcp/e2e/planning-search-tools.spec.ts`                 | create: test 9                            |
| `mcp/README.md`, `docs/mcp.md`, `docs/canonical/0005-…` | modify: section 3                         |

## Data model changes

None.

## API contract

None: the tools call existing endpoints.

## Test plan (written first, in this order)

| #   | Level | Test                                                                                                                                                      | Covers criterion |
| --- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit  | `query()` appends each value of an array, in order, and leaves out absent fields                                                                          | 2                |
| 2   | unit  | the five tools are offered with `tasks:read`, to a `qa_agent` and a `worker_agent`, in the order of section 2; none without `tasks:read`                  | 1                |
| 3   | unit  | each is read-only, names `tasks:read`, ends with the data notice, and its input JSON Schema has the filters as a value or an array                        | 1, 2, 3          |
| 4   | unit  | `opanel_search_tasks` sends `q`, repeated filters, `projectId` and `sort` as the API reads them, and answers the page with its summary                    | 2, 3             |
| 5   | unit  | `opanel_get_backlog` and `opanel_list_epics` send the project, the filters or `status`, and the page; `opanel_list_labels` the project                    | 2, 3             |
| 6   | unit  | `opanel_get_task_activity` encodes the key, passes the page, and summarises changes and comments                                                          | 2, 3             |
| 7   | unit  | an invalid input (a 21st value, `dueFrom` after `dueTo`, an unknown sort, a malformed key) is refused with no request                                     | 2                |
| 8   | unit  | a `403` and an answer that does not match its schema are tool errors with the request id; the token never appears in any result                           | 4                |
| 9   | e2e   | over stdio, an agent restricted to one project: backlog, labels, epics, a search by words and filters, a task's activity; another project is a tool error | 5                |
| 10  | unit  | `mcp/README.md`'s tool table lists the five (the existing `guide.test.ts` test, failing until the table has them)                                         | 6                |

## Risks and open questions

Questions for the owner, each with a recommendation:

1. **Where the five go in the tool list.** An assistant reads the list in order.
   **Recommend: the project reads together (board, backlog, labels, epics), then teams and
   people, then the task reads (search, task, activity),** as section 2 lists them.
2. **Filters on the backlog tool.** The backlog takes every filter but `columnId`, and the
   schemas come for free. **Recommend: the backlog tool takes them,** so an assistant can
   ask for "the urgent bugs in the backlog" in one call.
3. **One e2e spec or more steps in `read-tools.spec.ts`.** That spec reads WT-11's first
   tools as an unrestricted agent. **Recommend: a new spec,
   `mcp/e2e/planning-search-tools.spec.ts`, with a restricted agent,** so the project
   restriction is checked through the tools too.

Risks:

- **The order change moves existing tools** (`opanel_list_teams`, `opanel_find_people`
  after the new project reads). The README table and the offered lists in the tests follow
  it; tool names do not change, so configured clients keep working.
- **Repeated parameters are new to `query()`.** Test 1 covers it, and the existing tools
  pass only single values, so their requests do not change.
- **`mcp/e2e/write-tools.spec.ts` fails now and then** (the follow-up found in WI-129).
  The new spec uses its own projects and agent; a flake in the old spec during the gate is
  rerun and recorded, not fixed here.
