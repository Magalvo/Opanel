# 0005 — MCP server: Opanel as tools for AI assistants

- Status: **Approved** (2026-11-16, questions 1 to 4 as proposed)
- Date: 2026-11-16
- Supersedes: none
- Relates to: [0001](0001-ai-qa-agents-and-triage.md) (agent accounts, tokens, scopes, bug
  reports), [0004](0004-api-conventions.md) (the API it wraps), [0003](0003-task-management.md)
  (what the tools act on)

## 1. Context

Opanel's agents are external clients of `/api/v1` (doc 0001): Opanel runs no agents and
makes no LLM calls. That stays true. What doc 0001 leaves open is how an agent is built.
Today an agent has to read the OpenAPI document and write HTTP requests itself.

Many teams already use an AI assistant with a subscription, such as Claude Code (command
line or desktop app), rather than writing an agent program that pays per token. These
assistants take tools through the **Model Context Protocol (MCP)**. With an MCP server for
Opanel, such an assistant can read the board, work tickets and file bug reports through
typed tools, under its own agent account, without custom code.

Whether a given subscription allows unattended or scheduled runs, and how they are billed,
depends on the AI vendor's terms. That is the agent operator's concern, as scheduling
already is (doc 0001 section 2). This doc makes no assumption about it.

## 2. Summary of decisions

| Topic          | Decision                                                                 |
| -------------- | ------------------------------------------------------------------------ |
| What it is     | A thin MCP server that turns `/api/v1` operations into tools             |
| Business logic | None. Every tool is one or a few API calls; the API enforces every rule  |
| Where it runs  | Beside the assistant (the operator's machine or CI), not inside Opanel   |
| Transport      | stdio only in v1. A remote (HTTP) MCP endpoint is out of scope           |
| Identity       | An Opanel agent token (doc 0001 section 4); every action is the agent's  |
| Tools offered  | Only those the token's permissions allow, read from `GET /api/v1/me`     |
| Contracts      | Tool inputs and outputs reuse the Zod schemas of `src/lib/schemas/`      |
| Library        | The official MCP TypeScript SDK; package and version pinned by work-spec |
| Code location  | A package of its own in this repository, `mcp/` (question 2)             |
| When           | After WT-05 (agent tokens) and WT-06 (bug reports), as WT-11             |

## 3. Architecture

```
 AI assistant (Claude Code, desktop app, ...)        Opanel (Next.js + PostgreSQL)
 --------------------------------------------        ------------------------------
        |  MCP over stdio
        v
 opanel-mcp (this doc)
   reads OPANEL_URL, OPANEL_TOKEN
   GET /api/v1/me  -> which tools to offer
        |
        |  HTTPS, Authorization: Bearer opk_...
        +--------------------------------------------> /api/v1, as any agent
```

- The server is a separate process the assistant starts (its MCP configuration names the
  command, `OPANEL_URL` and `OPANEL_TOKEN`). It holds no state and opens no port.
- It is **just another API client**. It has no database access and no route of its own,
  and Opanel's server needs no change for it (`AGENTS.md` section 3: no side channel).
  Authentication, permission checks, project restrictions, validation, rate limits,
  history and the audit log all stay in the API.
- On start it calls `GET /api/v1/me`, which already returns the account's `kind` and
  `permissions`; WT-05 makes it answer agent tokens too. It stops with a clear message if the token is
  rejected or the account is not an agent, and it offers only the tools whose permission
  the account holds. An assistant is never shown a tool that can only fail with `403`.

## 4. Tools (first set)

Named `opanel_<verb>_<thing>`. Each tool's description names its permission. The first
set follows the scopes of doc 0001 section 3:

| Tool                       | API                                                      | Permission       |
| -------------------------- | -------------------------------------------------------- | ---------------- |
| `opanel_whoami`            | `GET /me`                                                | authenticated    |
| `opanel_list_projects`     | `GET /projects`                                          | `projects:read`  |
| `opanel_get_board`         | `GET /projects/{id}/columns` and every page of its tasks | `tasks:read`     |
| `opanel_list_teams`        | `GET /teams`                                             | `projects:read`  |
| `opanel_find_people`       | `GET /people?q=`                                         | `projects:read`  |
| `opanel_get_task`          | `GET /tasks/{idOrKey}` and its comments                  | `tasks:read`     |
| `opanel_add_comment`       | `POST /tasks/{idOrKey}/comments`                         | `comments:write` |
| `opanel_create_task`       | `POST /projects/{id}/tasks`                              | `tasks:write`    |
| `opanel_update_task`       | `PATCH /tasks/{idOrKey}` (fields, assignment, epic)      | `tasks:write`    |
| `opanel_move_task`         | `POST /tasks/{idOrKey}/move`                             | `tasks:write`    |
| `opanel_submit_bug_report` | `POST /projects/{id}/bug-reports` (WT-06)                | `reports:write`  |

- **No delete or restore tools**, and nothing for configuration (projects, columns,
  teams, accounts, tokens). Agents cannot hold those permissions anyway (doc 0001), and
  destructive actions stay with humans in the web app.
- Tools accept a task key (`OPA-12`) wherever the API accepts one.
- **Writes that need `version`** (`update`, `move`) take it as input. A
  `409 version_conflict` is returned as a tool error that includes the current task, so
  the assistant can look again and retry. The server never retries a write on its own.
- Lists follow the API's cursors. A tool returns one page with its `nextCursor`, except
  `opanel_get_board`, which loads the whole board as the web app does.
- New tools are added by work-items, like endpoints. A new tool needs no new permission:
  it can only do what an existing endpoint allows.

## 5. Inputs, outputs and errors

- Tool input schemas are built from the request schemas of `src/lib/schemas/`, so a tool
  cannot drift from the endpoint it calls. Inputs are validated before any request.
- Outputs are the API's JSON (as structured content, with a short text summary), parsed
  with the response schemas. A response that does not match is reported as an error,
  never passed on unchecked.
- API problems (doc 0004 section 4) become tool errors that carry `status`, `code`,
  `detail` and field `errors`. The `requestId` is kept, so an operator can find the
  request in the logs.

## 6. Security

- **The token** comes only from the `OPANEL_TOKEN` environment variable. It is never
  accepted as a tool argument, never written to a tool result, log or error message
  (hard rule 7). `OPANEL_URL` and `OPANEL_TOKEN` are validated with Zod at start
  (hard rule 4).
- **Least privilege.** Operators create a dedicated agent account for the assistant, with
  the narrowest role and project restriction that fits (doc 0001). The MCP server cannot
  widen it.
- **Transport security.** `https` is expected. Plain `http` is accepted, because an
  install on a private network is supported (WS-041), but the server writes a warning to
  stderr at start for any host other than `localhost`.
- **Content is data, not instructions.** Task titles, descriptions and comments are
  written by people and other agents, so a tool result may contain text that tries to
  steer the assistant (prompt injection). Tool descriptions say so, and results mark
  user-written fields as such. The real limit is the agent's permissions: an agent
  without `tasks:write` cannot be talked into editing tasks.
- **Attribution.** Every change is made by the agent account and recorded in the task
  history or audit log like any other (hard rule 8).

## 7. Packaging

- A package of its own in this repository, `mcp/` (question 2), written in TypeScript
  under the same strict rules, importing the shared schemas from `src/lib/schemas/`.
- It is built to plain JavaScript and started with Node.js (`node mcp/dist/index.js`).
  Publishing it to npm (for `npx`) is a release decision, outside this doc (question 3).
- One dependency is added: the official MCP TypeScript SDK (question 1). It is a runtime
  dependency of the MCP package only, never of the web app.

## 8. Testing

- **Unit:** each tool's input schema and the request it makes, against a fake `fetch`;
  problem-to-error mapping; the tool list for each set of permissions; that the token
  never appears in any output.
- **Integration (end-to-end):** the MCP server started over stdio by the SDK's own
  client, against the running app of the end-to-end suite with a seeded agent token. It
  lists the tools, reads the board, comments, moves a task and handles a version
  conflict, and the changes are checked through the API.
- The same quality gate as the rest of the repository (`AGENTS.md` section 5).

## 9. Out of scope (v1)

- A remote MCP endpoint over HTTP. It would need OAuth, which v1 excludes (doc 0001
  section 9), and it would put a new public surface on the server.
- MCP resources, prompts and sampling. Tools only.
- Live updates over MCP. Assistants read the current state when they need it; live sync
  stays with the web app (doc 0002).
- Running or scheduling the assistant, and a reference QA agent (doc 0001 section 9).
- Any LLM call inside Opanel or inside the MCP server.

## 10. Changes to `AGENTS.md`

Applied when this doc was approved:

- **Section 2, tech stack:** a row "Agent tools | MCP server over stdio, a client of
  `/api/v1` (canonical doc 0005)". The SDK package is named in section 2 of this doc.
- **Section 3, directory conventions:** "`mcp/` MCP server package (doc 0005, WT-11): a
  client of /api/v1, no DB access".

## 11. Resolved questions

The owner approved all four as recommended on 2026-11-16.

1. **Which SDK package.** The official TypeScript SDK now comes in two lines:
   `@modelcontextprotocol/sdk` 1.32.2 (the npm `latest` tag; one package with server,
   client and HTTP transports, which brings Express and Hono with it) and the newer split
   `@modelcontextprotocol/server` 2.4.0 (server only, on Zod 4 like Opanel, far fewer
   dependencies). **Recommend `@modelcontextprotocol/server` 2.x**, pinned by the first
   work-spec after reading its documentation for the installed version (hard rule 13).
2. **Where the package lives.** `mcp/` at the repository root as a pnpm workspace package,
   so it has its own dependencies and build, and the web app never depends on it.
   Alternative: inside `src/` and run with `tsx`, which is simpler but mixes its
   dependency into the web app. **Recommend `mcp/` as a workspace package.**
3. **Publishing to npm** so operators can run `npx` without a checkout. **Recommend
   later**, with the release work: v1 documents running it from a checkout or a built
   copy.
4. **Order.** As WT-11, after WT-06, so the first version already has bug reports.
   Alternative: right after WT-05, without the bug-report tool, to work tickets earlier.
   **Recommend after WT-06.**
