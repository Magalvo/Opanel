# WS-104 — The MCP write tools: comment, create, update and move a task

- Status: Approved (approved by the owner on 2026-11-22, questions 1 to 5 as proposed)
- Work-item: [WI-104](../work-items/WI-104-mcp-write-tools.md)
- Canonical docs: [0005](../canonical/0005-mcp-server.md) (sections 4 to 6),
  [0004](../canonical/0004-api-conventions.md) (problems, `version`),
  [0001](../canonical/0001-ai-qa-agents-and-triage.md) (scopes)

## 1. Approach

Four tools in `mcp/src/tools/`, one file each, registered in `TOOLS` after the read tools.
Nothing changes in the app or `/api/v1`.

| Tool                 | Request                                  | Permission       | Answer          |
| -------------------- | ---------------------------------------- | ---------------- | --------------- |
| `opanel_add_comment` | `POST /tasks/{taskId}/comments`          | `comments:write` | `201`, comment  |
| `opanel_create_task` | `POST /projects/{projectId}/tasks`       | `tasks:write`    | `201`, the task |
| `opanel_update_task` | `PATCH /tasks/{taskId}` with `version`   | `tasks:write`    | `200`, the task |
| `opanel_move_task`   | `POST /tasks/{taskId}/move` with version | `tasks:write`    | `200`, the task |

**Inputs.** Each input schema is the endpoint's request schema extended with its path
parameter: `taskParamsSchema`'s `taskId` (an id or a key such as `OPA-12`), or
`projectParamsSchema`'s `projectId` for `opanel_create_task`. Zod 4.6 keeps the request
schema's refinements through `.extend` (checked: `createTaskRequestSchema.extend(...)`
still refuses a severity on a task that is not a bug), so the cross-field rules hold
before any request. The tool splits the parameter off and sends the rest as the body.

**The API client** gains one method beside `get`:
`send(method: "POST" | "PATCH", path, body, schema)`. It sends JSON with
`Content-Type: application/json` and the agent's token, parses a `2xx` body with `schema`,
and turns a problem into a `ToolFailure` as `get` does. Two differences:

- **No retry, and a careful timeout.** A write is sent once. A timeout or a dropped
  connection on a write is the failure `unreachable` with a message that the change may
  have been made, and to read the task (`opanel_get_task`) before trying again. The
  server never retries a write (doc 0005 section 4).
- **The current entity of a conflict.** `ToolFailure`'s `problem` gains an optional
  `current: unknown`, kept from the problem body only when `code` is `version_conflict`.
  `opanel_update_task` and `opanel_move_task` parse it with `taskSchema`: when it
  matches, the tool error carries it, with a sentence saying the task changed since that
  `version` and to look at the current one before retrying; when it does not, the error
  is the conflict without it.

**Results.** As the read tools: structured content holding the API's JSON, and a text
summary followed by the same JSON. The summary names what changed (for example
`Created OPA-13, a task: "…", in To do.`) and quotes every text a person or agent wrote,
after the notice that it is data, not instructions (`DATA_NOT_INSTRUCTIONS`, `quote`).

**Annotations** (question 3). `readOnlyHint: false` on all four; `idempotentHint: false`
on all four (each call is a new comment, a new task, a new history entry);
`destructiveHint: true` on `opanel_update_task` only, which replaces a title, a
description or an assignment, and `false` on the other three.

**Descriptions** say what the tool changes, name its permission, say that `taskId`
accepts a key, and for the two versioned tools, that `version` comes from
`opanel_get_task` or the board and that a conflict answers the current task. Ids the
tools need come from the read tools: columns and tasks from `opanel_get_board`, teams
from `opanel_list_teams`, people from `opanel_find_people`. Epics have no read tool yet
(question 2).

**Documentation.** Doc 0005 section 4 gains the fields each write tool takes (priority,
due date and severity came after the doc), `mcp/README.md` lists the four tools, and
WT-11 records that item C is WI-104.

## 2. Files

| Path                                   | Change                                                       |
| -------------------------------------- | ------------------------------------------------------------ |
| `mcp/src/api.ts`                       | modify: `send`, `current` on a conflict, the write timeout   |
| `mcp/src/api.test.ts`                  | modify: `send`                                               |
| `mcp/src/errors.ts`                    | modify: the conflict sentence, the "may have been made" text |
| `mcp/src/tools/results.ts`             | modify: `WRITE`, `UPDATE` annotations; a write result helper |
| `mcp/src/tools/comment.ts`             | create: `opanel_add_comment`                                 |
| `mcp/src/tools/create-task.ts`         | create: `opanel_create_task`                                 |
| `mcp/src/tools/update-task.ts`         | create: `opanel_update_task`                                 |
| `mcp/src/tools/move-task.ts`           | create: `opanel_move_task`                                   |
| `mcp/src/tools.ts`                     | modify: the four tools in `TOOLS`                            |
| `mcp/src/write-tools.test.ts`          | create: unit tests of the four tools                         |
| `mcp/src/tools.test.ts`                | modify: what each default role is offered                    |
| `mcp/e2e/write-tools.spec.ts`          | create: the end-to-end test                                  |
| `mcp/e2e/agent.ts`                     | modify: `agentWithToken` takes a role and its scopes         |
| `mcp/README.md`                        | modify: the write tools                                      |
| `docs/canonical/0005-mcp-server.md`    | modify: section 4, the write tools' fields                   |
| `docs/work-tracks/WT-11-mcp-server.md` | modify: item C is WI-104                                     |

## Data model changes

None.

## API contract

None: the tools call existing endpoints with their existing schemas and permissions.

## 3. Test plan (written first, in this order)

All in Vitest's `mcp` project with a fake `fetch`, except test 12.

| #   | Level | Test                                                                                                                                                                                                                                                                  | Covers criterion |
| --- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit  | `send` posts JSON with the token and `Content-Type`, parses the `2xx` body, and turns a problem into a failure; a `409 version_conflict` keeps `current`, another `409` drops it                                                                                      | outputs, errors  |
| 2   | unit  | `send` makes one request only: a network error or a timeout is `unreachable` with the "may have been made" message, and `fetch` was called once                                                                                                                       | no retry         |
| 3   | unit  | Every scope of `qa_agent` gives `opanel_add_comment` and not the three task writes; every scope of `worker_agent` gives all four; `tasks:write` alone gives the three                                                                                                 | permissions      |
| 4   | unit  | Each write tool names its permission, is not `readOnlyHint` nor `idempotentHint`, and only `opanel_update_task` is `destructiveHint`                                                                                                                                  | tools            |
| 5   | unit  | `opanel_add_comment` by key posts `{ body }` to the task's comments and answers the comment, its body quoted after the notice                                                                                                                                         | comment, data    |
| 6   | unit  | `opanel_create_task` by project key posts the body without `projectId` and answers the task; `columnId: null` (the backlog) is sent as `null`                                                                                                                         | create           |
| 7   | unit  | Invalid inputs make no request: a severity on a non-bug, an update with only `version`, a move with both anchors, a missing `version`, an unknown field, a malformed key                                                                                              | inputs           |
| 8   | unit  | `opanel_update_task` sends `PATCH` with `version` and only the given fields (a `null` kept as `null`), and answers the task                                                                                                                                           | update           |
| 9   | unit  | `opanel_move_task` sends the column, the anchor and `version`, and answers the task with its new column in the summary                                                                                                                                                | move             |
| 10  | unit  | A `409 version_conflict` on update and on move is a tool error holding the current task and the retry sentence; a `current` that does not match the task schema is left out                                                                                           | conflicts        |
| 11  | unit  | An answer that does not match the response schema is an `unexpected_response` tool error; with the token in a problem's `detail`, no result or error of the four holds it                                                                                             | outputs, token   |
| 12  | e2e   | Over stdio against the running app: a `worker_agent` creates, updates, moves and comments; a stale `version` gets the conflict with the current task; the task's history shows each change under the agent; a `qa_agent` is offered only the comment among the writes | end to end       |

## 4. Risks and open questions

1. **Moving to the backlog.** `opanel_move_task` takes `columnId: null` as the API does,
   so an agent can move a task off the board into the backlog. Proposed: allow it, since
   the endpoint and `tasks:write` already do, and the index's follow-up from WT-07
   question 7 expects "the backlog move" in the existing tools; the description says
   `null` is the backlog.
2. **Epics.** `opanel_create_task` and `opanel_update_task` take `epicId`, but no tool
   lists a project's epics; an assistant sees an epic id only on a task it read.
   Proposed: keep `epicId` in both tools and record an `opanel_list_epics` read tool as a
   follow-up for WT-11, beside the `opanel_get_backlog` and `opanel_list_labels` the
   index's follow-ups already name.
3. **`destructiveHint`.** Proposed: `true` on `opanel_update_task` only, as section 1
   says, so a client that asks before destructive tools asks before an update replaces a
   title, a description or an assignment. The alternative is `false` everywhere, since
   every change is in the task history and can be put back.
4. **Write timeout.** Proposed: the read tools' 30 s, with the "may have been made"
   message. A longer one would only delay the same answer.
5. **The end-to-end test runs in the existing `mcp` Playwright project**, after
   `read-tools.spec.ts`, against the same app; it creates its own project so it shares no
   state with the other specs (WS-052).

## Implementation record

- Red: `abc2116`, tests 1 to 11: 27 tests failing because `send` and the four tools did
  not exist. The tests that list a `qa_agent`'s tools (`read-tools.test.ts`, and
  `mcp.spec.ts` end to end) gained `opanel_add_comment` at their end, as section 1
  intends.
- Green: `0f1b5c5`. `ToolFailure` keeps `current` for `version_conflict` only, and
  `toolError` never shows it; `conflictError` shows it once it matches `taskSchema`.
- Test 12: `bbc528a`, two specs in `mcp/e2e/write-tools.spec.ts`. The worker's history
  reads `created`, `field_changed`, `moved`, `commented`, each under the agent.
- Docs: `mcp/README.md` lists the four tools; doc 0005 section 4 says what they take
  and that a write without an answer may have been made; WT-11 names WI-104.

## Deviations

1. **The history is read from the database in test 12.** `/api/v1` has no endpoint for a
   task's history, so `mcp/e2e/agent.ts` gains `taskHistory`, which reads `task_events`
   from the end-to-end database, as `tests/e2e/seed.ts` already reaches it.
2. **`agentWithToken` takes a role** and gives the agent every scope of it
   (`scopesOfRole`), sorted as `GET /me` lists them; the `qa_agent` it made before had
   exactly those scopes.
3. **The test helpers' `FakeCall` records the request body**, which the write tests check.

## Follow-ups

1. An `opanel_list_epics` read tool, so an assistant can find the `epicId` the task writes
   take (question 2). Recorded in the index.
