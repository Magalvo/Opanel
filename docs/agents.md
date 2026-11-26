# Writing an agent for Opanel

This guide is for someone writing a program that works with Opanel: a QA agent that reads
boards and files findings, or a worker that picks up tasks. Your program is an **agent**,
with an account and a token of its own, and it talks to Opanel through the same REST API
the web app uses, `/api/v1`. The design behind it is canonical doc
[0001](canonical/0001-ai-qa-agents-and-triage.md).

## What an agent is

- **An account of its own.** Everything it does is recorded as done by it: its comments,
  the tasks it changes, and the history of each. People see its name with an "Agent"
  badge.
- **A role, scopes and projects.** An Admin gives it a role, `qa_agent` or
  `worker_agent`, and the scopes within that role. It reaches either all projects or only
  the ones listed.
- **An external program.** Opanel never runs your agent and calls no model. Your program
  schedules itself, does its work, and calls the API.

## Getting a token

An Admin of the Opanel install creates your agent and its token:

1. **Agents** in the sidebar, then **New agent**: a name, a role, its scopes and its
   projects.
2. On the agent's page, **Create token**: a name (where it is used, for example "CI
   runner") and an expiry (30, 90 or 365 days, or none).
3. The token, `opk_…`, is shown **once**. Store it as a secret where your program reads
   its configuration. Opanel keeps only a hash and cannot show it again.

Scripts can do the same through `POST /api/v1/agents` and
`POST /api/v1/agents/{agentId}/tokens`, with an Admin's session.

## Sending it

Send the token on every request, in the `Authorization` header:

```bash
curl -H "Authorization: Bearer $OPANEL_AGENT_TOKEN" https://opanel.example.com/api/v1/me
```

- **No cookie and no `Origin` header** are needed. When `Authorization` is present, Opanel
  ignores cookies.
- **Bodies are JSON** (`Content-Type: application/json`). Unknown fields are refused, not
  ignored.
- **No CORS headers.** The API sends none, so call it from a server or a script, never from
  a web page.

## What a token can do

A token can do exactly what its agent's scopes allow:

| Scope            | Allows                                     |
| ---------------- | ------------------------------------------ |
| `projects:read`  | See projects, teams and people             |
| `tasks:read`     | Read tasks, epics and comments, and events |
| `reports:write`  | Submit bug reports                         |
| `comments:write` | Comment on tasks                           |
| `tasks:write`    | Create and edit tasks                      |

- **The roles.** `qa_agent` holds the first four; `worker_agent` adds `tasks:write`. An
  Admin may remove scopes from an agent, never add one its role lacks.
- **Never more.** No agent can manage accounts, agents, tokens, projects or teams, or
  delete tasks.
- **The project restriction.** A restricted agent sees only its projects: the others are
  missing from lists, and any request about them answers `403`.

The OpenAPI document names the permission each operation needs (`x-opanel-permission`).

## Knowing yourself

Start by asking who you are. `GET /api/v1/me` answers, for a token:

```json
{
  "id": "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f",
  "kind": "agent",
  "name": "QA bot",
  "role": "qa_agent",
  "permissions": ["comments:write", "projects:read", "reports:write", "tasks:read"],
  "projectIds": ["7c1f0e9e-2c39-4c1e-9b8e-2b6f4f1c5a01"]
}
```

- `projectIds` is `null` when the agent reaches every project.
- Check `permissions` before offering an action, rather than finding out from a `403`.

## Errors and limits

Every error is a problem-details body (RFC 9457) with a stable `code`. Branch on `status`
and `code`, never on the wording of `detail`. Quote `requestId` when you report a
problem; the response's `X-Request-Id` header carries the same value.

| Status | `code`              | What to do                                                               |
| ------ | ------------------- | ------------------------------------------------------------------------ |
| `400`  | `invalid_request`   | Fix the request; `errors` names each field                               |
| `401`  | `unauthenticated`   | The token is wrong, expired or revoked, or the agent is disabled         |
| `403`  | `forbidden`         | A scope is missing, or the project is not yours                          |
| `404`  | `not_found`         | It does not exist                                                        |
| `409`  | `version_conflict`  | Someone changed it first: `current` holds it as it is now; retry on that |
| `409`  | `project_archived`  | The project is read-only                                                 |
| `409`  | `account_inactive`  | The person you assign is deactivated                                     |
| `413`  | `payload_too_large` | Keep JSON bodies under 512 KiB                                           |
| `429`  | `rate_limited`      | Wait the `Retry-After` seconds; a token may make 600 requests a minute   |
| `429`  | `too_many_streams`  | Close a stream; wait the `Retry-After` seconds                           |
| `500`  | `internal_error`    | Retry later; report the `requestId`                                      |

- **`401` never says why.** An unknown, expired or revoked token, and a disabled agent, all
  get the same answer.
- **A token that keeps failing slows its address down.** When the install trusts a
  client-address header, an address may fail token authentication 30 times a minute; its
  further token requests that minute get `429 rate_limited`, even with a valid token. Fix
  the token, then wait the `Retry-After` seconds.
- **Retrying.** Writes are not idempotent, except a `DELETE`: before retrying a create
  after a timeout, check whether it happened.

## Lists

Every list is paginated with a cursor:

```bash
curl -H "Authorization: Bearer $OPANEL_AGENT_TOKEN" \
  "https://opanel.example.com/api/v1/projects?limit=100"
```

- A list answers `{ "items": [...], "nextCursor": "..." }`.
- Pass `nextCursor` back as `cursor` until it is `null`.
- `limit` is 50 by default, at most 100.
- There are no page numbers and no total count.

## Tasks and the backlog

- **Where a task is.** `columnId` is the task's column, or `null` when the task is in the
  backlog: the project's tasks that are not on the board.
  `GET /api/v1/projects/{projectId}/tasks` lists the board, in board order, and
  `GET /api/v1/projects/{projectId}/backlog` lists the backlog, in the team's ranking.
- **Moving.** `POST /api/v1/tasks/{taskId}/move` with `columnId: null` puts a task in the
  backlog, and with a column's id puts it on the board. `afterTaskId` or `beforeTaskId`
  place it; without either it goes to the end. Send the task's `version`. It needs
  `tasks:write`.
- **Priority.** `priority` is one of `none`, `low`, `medium`, `high` or `urgent`, and
  `none` by default. It is the team's ordering, not a bug's severity: a bug report never
  sets it.
- **Due date.** `dueDate` is a calendar date, `YYYY-MM-DD`, or `null`. It has no time
  of day.
- **Who may set them.** An agent with `tasks:write` may set `priority` and `dueDate`
  when it creates or edits a task, and the task's history names the agent.
- **Labels.** `labels` lists the task's labels as `{ id, name, colour }`, and
  `GET /api/v1/projects/{projectId}/labels` lists the project's. Agents read labels but do
  not apply them: a body with `labelIds` answers `403`.

## Finding tasks

Search and filters are query parameters of the task lists:

```bash
curl -H "Authorization: Bearer $OPANEL_AGENT_TOKEN"   "https://opanel.example.com/api/v1/tasks?q=login%20fails&type=bug&priority=high&priority=urgent"
```

- **Text search.** `q` finds a task by its key (`OPA-12`, in any case) or by words of its
  title and description, the last word as a prefix: "log fai" finds "Login fails". Words
  match as written, in any language.
- **Filters.** Each filter is a parameter named after the field: `projectId`, `type`,
  `columnId`, `category`, `done`, `assigneeTeamId`, `assigneeAccountId`,
  `reporterAccountId`, `reporterKind`, `labelId`, `epicId`, `parentId`, `priority`, `severity`,
  `dueFrom` and `dueTo`. A repeated parameter means any of its values, and different
  parameters must all hold. `none` matches an empty field and `me` your own account. At
  most 20 values each; an unknown value is a `400` naming the parameter.
- **Where they apply.** `GET /api/v1/projects/{projectId}/tasks` and
  `GET /api/v1/projects/{projectId}/backlog` take every filter but `projectId`, and the
  backlog has no column filter. `GET /api/v1/tasks?projectId=OPA` lists the tasks of every
  project you may read, board and backlog together, or of the projects you name; a
  project outside your reach is a `403`.
- **Order.** The list across projects takes `sort`: `key`, `title`, `priority`,
  `dueDate`, `created` or `updated`, ascending, or with `-` before it, descending. The
  default is `-updated`, newest first. Tasks with no due date come last either way.
- **A task's history.** `GET /api/v1/tasks/{taskId}/activity` lists its changes and
  comments, oldest first, each change naming who made it, person or agent. Ids of
  accounts, teams, columns and epics come with their names, and a name is `null` when
  that thing was deleted.

## Live updates

`GET /api/v1/projects/{projectId}/events` is a Server-Sent Events stream of the project's
changes. It needs `tasks:read`, and the project must be one of yours.

- **What an event carries.** Each event carries a type (`task.created`, `task.moved`,
  `comment.created`, `label.changed`, …) and ids, not the data. Fetch what you need through
  the API.
- **Heartbeats.** A comment line arrives every 25 seconds. At each heartbeat the token is
  checked again, so a revoked token or a disabled agent loses its stream within 25
  seconds.
- **Reconnecting.** Events are not replayed. After a reconnect, reload what you track.
- **How many.** At most 10 open streams per account and app process; the 11th is a
  `429 too_many_streams`.

## Filing bug reports

A QA agent that finds a bug sends a report, and Opanel turns it into a ticket on the
project's board, assigned to the team that owns the layer at fault. The design is doc
[0001](canonical/0001-ai-qa-agents-and-triage.md), sections 5 and 6.

```bash
curl -X POST -H "Authorization: Bearer $OPANEL_AGENT_TOKEN" \
  -H "Content-Type: application/json" -d @report.json \
  https://opanel.example.com/api/v1/projects/OPA/bug-reports
```

`POST /api/v1/projects/{projectId}/bug-reports` needs `reports:write`; `projectId` is the
project's id or its key. Only agents hold that scope: a person files a bug by creating a
task of type `bug`.

### The body

```json
{
  "title": "Checkout button returns 500",
  "originLayer": "api",
  "confidence": 0.8,
  "severity": "high",
  "fingerprint": "6f1c9a0e4b7d2c3f5a8e1b0d9c7f6a5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a",
  "summary": "Placing an order fails with a server error.",
  "evidence": {
    "stepsToReproduce": ["Add an item to the cart", "Press Place order"],
    "expected": "The order is placed",
    "actual": "An error page",
    "url": "https://app.example.com/checkout",
    "http": { "method": "POST", "path": "/api/orders", "status": 500, "responseSnippet": "{}" },
    "consoleErrors": ["TypeError: order is undefined"],
    "diagnosis": "The API answers 500 to a valid request."
  },
  "runId": "nightly-2026-11-20"
}
```

| Field         | Rules                                                                      |
| ------------- | -------------------------------------------------------------------------- |
| `title`       | Required, 1 to 200 characters; the task's title                            |
| `fingerprint` | Required, 1 to 128 printable ASCII characters (see below)                  |
| `originLayer` | `frontend`, `api`, `backend` or `unknown` (the default)                    |
| `severity`    | `low`, `medium` (the default), `high` or `critical`                        |
| `confidence`  | Optional, 0 to 1: how sure you are of `originLayer`                        |
| `summary`     | Optional Markdown, up to 10 000 characters                                 |
| `evidence`    | Optional; every field optional and bounded                                 |
| `runId`       | Optional, up to 128 characters: the same value for every report of one run |

The OpenAPI document has every limit (`SubmitBugReportRequest`). Unknown fields are
refused. Opanel renders the summary and evidence into the task's description, each value
in a code block, and keeps the report itself as you sent it.

### The two outcomes

- **`201`**, `outcome` `created`: a new bug task.
  `{ "outcome": "created", "taskId": "…", "taskKey": "OPA-12", "assignedTeamId": "…" }`.
  `assignedTeamId` is `null` when no team owns the layer: the bug is created unassigned,
  and its first comment says so.
- **`200`**, `outcome` `deduplicated`: an open bug with the same fingerprint exists, and
  the report counts on it.
  `{ "outcome": "deduplicated", "taskId": "…", "taskKey": "OPA-12", "occurrences": 3 }`.

Either way the report is kept. Never retry a `2xx`. Other answers: `400` names the field;
`403` when the project is not one of yours; `409 project_archived` for a read-only project.

### Where a bug goes

Choose the layer at fault:

| Layer      | When                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------ |
| `frontend` | Rendering, client-side logic or UI state is wrong while API responses are correct                |
| `api`      | The HTTP contract is violated: wrong status, schema, validation, auth handling                   |
| `backend`  | The contract is honored but the outcome is wrong: data, business logic, jobs, 5xx from internals |
| `unknown`  | You cannot tell                                                                                  |

Each project's Managers choose a team for each layer and a triage team, in the project's
Triage settings. `GET /api/v1/projects/{projectId}/triage` (`projects:read`) shows them.
`unknown`, and a layer with no team, go to the triage team. A new bug goes to the top of
the project's first column, with you as its reporter, so people see it first.

### Fingerprints

The fingerprint says which reports are the same bug. Compute it as a hash (for example
SHA-256, in hex) of:

- the layer;
- the route or endpoint, normalised: `/orders/{id}`, not `/orders/42`;
- the error signature: the error's type and message without its values.

Never put timestamps, ids, run ids or random values in it: two runs that meet the same bug
must send the same fingerprint.

- **While the bug is open**, a report with its fingerprint counts on it: the task's
  `occurrences` grows, and nothing else about it changes.
- **Once it is closed** (in a column of the `done` category), the same fingerprint opens
  a new bug, linked as a regression of the closed one.
- **A deleted bug** is never matched: a report about it opens a new bug.

A repeat adds a comment to the bug only when its last report is over an hour old or came
with another `runId`, so an agent that runs every few minutes does not bury the
discussion. Send one `runId` for every report of one run.

### Reading reports

`GET /api/v1/tasks/{taskId}/bug-reports` (`tasks:read`) lists the reports behind a task,
newest first, 10 by default and 25 at most. The task's own `GET` has `severity`,
`occurrences`, `lastReportedAt` and `links`, which name the bug it is a regression of.

An AI assistant connected through the MCP server ([`mcp/README.md`](../mcp/README.md))
files reports with the `opanel_submit_bug_report` tool, which takes the same body.

The optional PostHog add-on ([`addons/posthog/README.md`](../addons/posthog/README.md))
files reports this way from PostHog's error-tracking alerts.

## Rotating and revoking

- **Several tokens.** An agent may hold up to 10 usable tokens. To rotate, have a new one
  created, switch your program to it, then have the old one revoked.
- **Expiry.** A token stops working when it expires, so rotate before that date. The
  Agents page shows when each token was last used and when it expires.
- **Revoking.** Revoking takes effect at once, and so does disabling the agent. Both are
  done by an Admin, on the Agents page or through the API.

## The contract

- **The OpenAPI document.** `GET /api/v1/openapi.json` is the contract, generated from
  the same schemas the server validates with. It declares the bearer scheme
  (`bearerAuth`) and each operation's permission.
- **What may change.** Within `/api/v1`, responses may gain fields: ignore the ones you do
  not know. Removing or renaming anything needs a new version, `/api/v2` (doc
  [0004](canonical/0004-api-conventions.md), section 8). Until Opanel's first tagged
  release, v1 is still being built.

## What comes next

- **An AI assistant instead of a program.** The MCP server (doc
  [0005](canonical/0005-mcp-server.md)) gives an assistant such as Claude Code this API as
  tools, under an agent account and token like yours. Setting it up is in
  [Connecting an AI assistant](mcp.md).
