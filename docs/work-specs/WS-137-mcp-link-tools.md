# WS-137 — MCP tools for links, sub-tasks on the task tools

- Status: Done (approved by the owner on 2026-11-27, questions 1 to 3 as recommended; done on
  2026-11-27)
- Work-item: [WI-137](../work-items/WI-137-mcp-link-tools.md)
- Canonical docs: [0005](../canonical/0005-mcp-server.md) sections 4 (the tools; "new
  tools are added by work-items") and 5 (inputs, outputs, errors);
  [WT-09](../work-tracks/WT-09-subtasks-and-links.md) decisions 7, 8 and 13 and question 8;
  [WS-104](WS-104-mcp-write-tools.md) (the write tools' rules); [WS-134](WS-134-links-api.md)
  (the link endpoints)

## Approach

### 1. Starting point, checked against `main` (`a5faf87`)

- **The tool list.** `mcp/src/tools.ts` lists sixteen tools. `offeredTools` keeps those
  whose `permissions` the agent holds. The write tools (WS-104) call `api.send("POST" |
"PATCH", …)`, and the API client sends a write once and never retries it.
  - A write that got no answer is the `unanswered` failure: "the change may have been
    made. Read the task with opanel_get_task before trying again."
- **What the API client cannot do yet.** It has no `DELETE`, and its answers always parse
  a JSON body, so a `204` cannot be read.
- **The link endpoints (WI-134).**
  - `POST /tasks/{taskId}/links` with `{ type, direction, taskId }` answers `200` with the
    task.
  - `DELETE /tasks/{taskId}/links?type=…&direction=…&taskId=…` answers `204`.
  - Both need `tasks:write` on both tasks.
  - Refusals: `400`, `403`, `404`, `409 link_exists`, `too_many_links` and
    `project_archived`.
  - `relates_to` reads `outgoing` from both tasks.
- **Sub-tasks on the task tools.** `opanel_create_task` and `opanel_update_task` build their
  input from `createTaskRequestSchema` and `updateTaskFields`, so they already take
  `parentId` (WT-09 question 8). Their descriptions do not mention it.
  - `opanel_get_task` answers the full task, with `parent`, `subtasks`, `subtaskList` and
    `links`. Its summary names only the key, type, title and comments.
- **Roles.** A `worker_agent` holds `tasks:read` and `tasks:write`. A `qa_agent` holds
  neither `tasks:write` nor any way to get it (doc 0001).

### 2. `opanel_add_link`

| Field         | Schema                                                       |
| ------------- | ------------------------------------------------------------ |
| `taskId`      | `taskRefSchema`: the task the link is read from, id or key   |
| `type`        | `blocks`, `duplicates`, `regression_of` or `relates_to`      |
| `direction`   | `outgoing` or `incoming`, as `taskId` reads the link         |
| `otherTaskId` | `taskRefSchema`: the other task, in any project it may reach |

- **The input** is a strict object built from `taskLinkRequestSchema`'s fields, with the
  body's `taskId` renamed `otherTaskId` (question 1).
- **The call** is `api.send("POST", "/tasks/{taskId}/links", { type, direction, taskId:
otherTaskId }, taskSchema)`.
- **The answer** is `readResult` with "OPA-1 now blocks API-3. Its version is now 5.". The
  reading comes from the task's `links` entry for the other task, with the words of
  `LINK_READINGS`, which today sits in `src/components/task/link-readings.ts`. It moves to
  `src/lib/schemas/task-links.ts`, beside the link request schema, because the MCP package
  may import only `@/lib/schemas` and `@/lib/openapi` (`mcp/src/boundaries.test.ts`). The UI
  file keeps `LINK_GROUPS`, the section's headings, and imports the readings from there.
- **The description** says what the types mean, that `direction` is read from `taskId`,
  that `relates_to` reads the same both ways, and that both tasks need `tasks:write`.
- **Permissions:** `tasks:write` and `tasks:read`, as `opanel_remove_link` needs.
- **Annotations:** `WRITE`. A second identical call is a `409`, so the tool is not
  idempotent.

### 3. `opanel_remove_link`

- **The input** is the same as `opanel_add_link`'s.
- **The call.** The API client gains `remove(path)`: `DELETE /api/v1<path>`, which answers
  `{ ok: true, value: null }` on a `204` and fails as `send` does otherwise, with the same
  `unanswered` message. The tool sends the link as `query()` parameters, with `taskId` set
  to `otherTaskId`.
- **The read after.** The tool then reads `GET /tasks/{taskId}` and answers that task, so
  the assistant has its new version (question 2). If the read fails, it answers a tool
  error that says the link was removed and the task could not be read.
- **The answer:** "OPA-1 no longer blocks API-3. Its version is now 6.". The reading comes
  from the input.
- **Permissions:** `tasks:write` and `tasks:read`.
- **Annotations:** `REPLACING_WRITE` (`destructiveHint`), since it removes what someone
  recorded.

### 4. Sub-tasks on the task tools

- **`opanel_create_task`'s description** adds: "parentId (a task's id or key, of the same
  project) makes it a sub-task, which takes its parent's epic."
- **`opanel_update_task`'s description** adds: "parentId sets the parent, and null makes it
  a normal task again; a sub-task's epic is its parent's, so epicId is refused on one."
- **`opanel_get_task`'s summary** gains, after the title, only the parts that apply:
  - "A sub-task of OPA-9.";
  - "2 of 5 sub-tasks done.";
  - "3 links."

### 5. Order and docs

- **Order in the list.** `opanel_add_link` and `opanel_remove_link` come after
  `opanel_move_task`, before `opanel_submit_bug_report`.
- **`mcp/README.md`.**
  - The two rows, in that order.
  - "a `worker_agent` the three task writes too" becomes "the task writes and the link
    tools too".
- **`docs/mcp.md` and `docs/agents.md`.** The `worker_agent` rows also link tasks. The
  agents guide's doc check is item F's (WT-09 decision 13), so this item changes only
  sentences that would become wrong.
- **Doc 0005 section 4.**
  - The two rows go in its table.
  - "No delete or restore tools" becomes "No tool deletes or restores a task".
    Removing a link is a change that both tasks' histories record (question 3).
  - Its "Amended by" line names this work-item.

## Files

| Path                                                        | Change                                          |
| ----------------------------------------------------------- | ----------------------------------------------- |
| `mcp/src/tools/links.ts`                                    | create: sections 2 and 3                        |
| `mcp/src/link-tools.test.ts`                                | create: tests 1 to 6                            |
| `mcp/src/api.ts`, `mcp/src/api.test.ts`                     | modify: `remove`; test 7                        |
| `mcp/src/tools.ts`                                          | modify: the two tools, in order                 |
| `mcp/src/tools/create-task.ts`, `update-task.ts`, `task.ts` | modify: section 4                               |
| `mcp/src/write-tools.test.ts`, `read-tools.test.ts`         | modify: tests 8 and 9                           |
| `src/lib/schemas/task-links.ts`                             | modify: `LINK_READINGS`, moved here from the UI |
| `src/components/task/link-readings.ts`, `activity-text.tsx` | modify: import the readings                     |
| `mcp/e2e/link-tools.spec.ts`                                | create: test 10                                 |
| `mcp/README.md`, `docs/mcp.md`, `docs/agents.md`, doc 0005  | modify: section 5                               |

## Data model changes

None.

## API contract

None. The tools use the endpoints of WI-133 and WI-134.

## Test plan (written first, in this order)

| #   | Level | Test                                                                                                                                                  | Covers criterion |
| --- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit  | a `worker_agent` is offered both tools after `opanel_move_task`, a `qa_agent` neither; descriptions name both permissions; only remove is destructive | 3                |
| 2   | unit  | `opanel_add_link` posts `{ type, direction, taskId: otherTaskId }` to the task by key and answers "OPA-1 now blocks API-3…" with the task             | 1                |
| 3   | unit  | `opanel_add_link` reads an incoming link and `relates_to` in their words ("is blocked by", "relates to")                                              | 1                |
| 4   | unit  | `opanel_remove_link` sends the `DELETE` with the query, reads the task, and answers "OPA-1 no longer blocks API-3…"                                   | 2                |
| 5   | unit  | the input refuses an unknown `type` or `direction` and a missing `otherTaskId`, and makes no request                                                  | 1, 2             |
| 6   | unit  | `link_exists`, `403`, `404` and `project_archived` are tool errors with status and code; a failed read after a removal says it was removed            | 4                |
| 7   | unit  | `remove` answers `null` on a `204`, a problem on a `404`, and the "may have been made" failure when Opanel does not answer                            | 2, 4             |
| 8   | unit  | `opanel_create_task` and `opanel_update_task` pass `parentId` (and `null`) through, and their descriptions mention it                                 | 5                |
| 9   | unit  | `opanel_get_task`'s summary names the parent, the progress and the number of links, and leaves out what does not apply                                | 6                |
| 10  | e2e   | a `worker_agent`'s assistant links tasks of two projects, reads the link from both tasks, removes it, and makes a task a sub-task                     | 8                |

`mcp/src/guide.test.ts` covers criterion 7, and the full quality gate covers criterion 9.

## Risks and open questions

Questions for the owner, each with a recommendation:

1. **The other task's name in the input.** The API's body calls it `taskId`, which the path
   task is also called in every tool. **Recommend: `otherTaskId`**, so `taskId` always
   means the task the tool acts on. The alternative is the API's own names, with the path
   task called something else.
2. **What `opanel_remove_link` answers.** The API answers `204` with no task. **Recommend:
   read the task after and answer it**, so the assistant has the version it needs for its
   next update. That needs `tasks:read`, which every agent with `tasks:write` holds. The
   alternative is to answer only the link removed.
3. **Doc 0005's "No delete or restore tools".** **Recommend: narrow it to tasks.** Removing
   a link is recorded on both tasks and can be undone with `opanel_add_link`, and WT-09
   question 8 already approved the tool. The alternative is to leave the sentence and add
   an exception.

Risk: moving `LINK_READINGS` touches two files of WI-136. Nothing else is in flight on
them.

## Implementation record

- Red (14c51d8): 24 unit tests failed, on `remove` missing from the API client, the two
  missing tools, the task tools' descriptions and `opanel_get_task`'s summary. The
  end-to-end test 10 was written in the same commit.
- Green (ecbf83d):
  - `mcp/src/tools/links.ts` holds both tools.
  - `ApiClient.remove` sends `DELETE` with no body or `Content-Type`, and answers `null` on
    a `204`.
  - `LINK_READINGS` moved to `src/lib/schemas/task-links.ts`. The UI's `link-readings.ts`
    keeps `LINK_GROUPS`.
  - The task tools' descriptions and `opanel_get_task`'s `relations()` cover section 4.
  - The docs follow section 5.
- Gate on 2026-11-27:
  - typecheck, lint and Prettier pass; `pnpm db:generate` and `pnpm openapi:generate`
    leave no diff;
  - Vitest 2675 of 2675 (239 files);
  - `pnpm test:e2e` 143 of 144. `tests/e2e/search-flow.spec.ts` (WI-131) failed in its
    agent test this time. It passed when run again alone, beside `mcp/e2e/link-tools.spec.ts`
    (test 10), which passed too. It is the follow-up recorded from WI-135, not fixed here;
  - Windows 11, pnpm 10.28.0, Compose PostgreSQL on port 5433.

## Deviations

1. **The answers start with "Linked:" and "Removed the link:"** rather than "OPA-1 now
   blocks API-3" and "no longer blocks". The readings are verb phrases ("is blocked by",
   "is a regression of"), and "now is blocked by" or "no longer is a regression of" read
   badly. "Linked: OPA-1 is blocked by API-3." reads well for all seven.
2. **Tests 8 and 9 are in `mcp/src/link-tools.test.ts`**, beside the link tools, not in
   `write-tools.test.ts` and `read-tools.test.ts`. They use that file's `serve` with a
   `worker_agent`.
3. **`docs/agents.md` is unchanged.** None of its sentences became wrong: it describes
   scopes, and `tasks:write` ("Create and edit tasks") still covers linking until item F
   writes the guide's section on sub-tasks and links (WT-09 decision 13).
4. **A failed read after a removal** answers a tool error that starts with "The link was
   removed, but OPA-12 could not be read after:", followed by the read's own error.
