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
| `reports:write`  | Submit bug reports (WT-06, not yet)        |
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

## Live updates

`GET /api/v1/projects/{projectId}/events` is a Server-Sent Events stream of the project's
changes. It needs `tasks:read`, and the project must be one of yours.

- **What an event carries.** Each event carries a type (`task.created`, `task.moved`,
  `comment.created`, …) and ids, not the data. Fetch what you need through the API.
- **Heartbeats.** A comment line arrives every 25 seconds. At each heartbeat the token is
  checked again, so a revoked token or a disabled agent loses its stream within 25
  seconds.
- **Reconnecting.** Events are not replayed. After a reconnect, reload what you track.
- **How many.** At most 10 open streams per account and app process; the 11th is a
  `429 too_many_streams`.

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

- **Bug reports and triage (WT-06).** A QA agent will submit structured bug reports, and
  Opanel will turn each into a ticket routed to the right team (doc 0001, section 5).
- **An MCP server (WT-11).** AI assistants such as Claude Code will use Opanel through
  tools, with an agent token (doc [0005](canonical/0005-mcp-server.md)).
