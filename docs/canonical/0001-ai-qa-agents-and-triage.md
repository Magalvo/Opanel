# 0001 — AI QA agents: identity, authentication and automated triage

- Status: **Approved** (2026-11-12)
- Date: 2026-11-12
- Supersedes: none
- Amended by: [0003](0003-task-management.md), section 12 (applied 2026-11-12); [WT-03](../work-tracks/WT-03-board-core.md) decision 17 (`projects:read` lists people, 2026-11-13)

## 1. Context

Opanel must let AI QA agents test a product's frontend and API and automatically file bugs
to the responsible team. Decisions already taken with the owner:

| Topic            | Decision                                                                  |
| ---------------- | ------------------------------------------------------------------------- |
| What agents test | Any product tracked in Opanel, including Opanel itself (dogfooding)       |
| Where agents run | Outside Opanel, as external API clients. Opanel runs no agents, no LLMs   |
| Agent auth       | Scoped, revocable API tokens. No passwords or browser sessions for agents |
| Human auth       | Email + password                                                          |
| Routing          | The agent classifies the origin layer; the server maps layer to team      |
| Duplicates       | Fingerprint dedupe against open tickets                                   |
| API              | REST `/api/v1` with OpenAPI generated from Zod                            |
| Tenancy          | One organization per install                                              |

## 2. Responsibilities

```
 External QA agent (any language/framework)            Opanel (Next.js + PostgreSQL)
 -------------------------------------------           ------------------------------
 schedules its own runs (cron, CI, ...)
 drives the product under test (browser, HTTP)
 diagnoses a failure, picks an origin layer
 computes a fingerprint
        |
        |  POST /api/v1/projects/{id}/bug-reports
        |  Authorization: Bearer <agent token>
        +--------------------------------------------> authenticate token, check scope
                                                       validate payload (Zod)
                                                       store the report
                                                       dedupe by fingerprint
                                                       route layer -> team
                                                       create or update the ticket
        <--------------------------------------------+ 201 created | 200 deduplicated
```

Opanel owns identity, permissions, storage, dedupe and routing. The agent owns scheduling,
test execution and diagnosis. "Periodically" in the requirements is therefore the agent
operator's concern; Opanel only records when each agent was last seen.

## 3. Identity model

Humans and agents share one `accounts` table, distinguished by `kind` (`human` | `agent`).
This keeps assignment, comments and the audit log uniform: an actor is always an account.

- **Human account**: email, password hash, role (`admin` | `manager` | `member` |
  `viewer`; permissions are defined in doc 0003).
- **Agent account**: unique name, description, role, set of scopes, owning human
  (the admin who created it), `disabled_at`, `last_seen_at`. No email, no password.

Agents are created, disabled and deleted only by human admins. An agent can never create
accounts or tokens.

### Roles and scopes

A role is a named bundle of permissions; permissions (also called scopes when held by an
agent) are what endpoints check. The single catalogue of all permissions, and the human
roles built from them, is `src/lib/schemas/permissions.ts` and `src/server/auth/roles.ts`
(WI-012). The table below lists the ones agents use.

| Scope            | Allows                                          |
| ---------------- | ----------------------------------------------- |
| `projects:read`  | List projects, teams, people and routing layers |
| `tasks:read`     | Read tasks, epics and comments                  |
| `reports:write`  | Submit bug reports                              |
| `comments:write` | Comment on tasks                                |
| `tasks:write`    | Create and edit tasks directly                  |

Initial agent roles:

- `qa_agent`: `projects:read`, `tasks:read`, `reports:write`, `comments:write`.
- `worker_agent` (reserved for later, e.g. agents that fix tickets): adds `tasks:write`.

An agent can additionally be restricted to specific projects.

## 4. Authentication

### Agents: API tokens

- Format: `opk_<publicId>_<secret>`. `publicId` is a short lookup key; `secret` is at
  least 256 bits from a CSPRNG.
- Storage: only `publicId` and `SHA-256(secret)` are stored. The full token is displayed
  once at creation. (A fast hash is sufficient because the secret is high-entropy.)
- Each token has: owning agent, optional expiry, `revoked_at`, `last_used_at`.
- An agent may hold several tokens to allow rotation without downtime.
- Sent as `Authorization: Bearer <token>`. Comparison is constant-time.
- Rejected with `401` when unknown, expired, revoked, or the agent is disabled; `403`
  when the scope or project restriction does not allow the call.
- Token-authenticated requests are rate limited per token.

### Humans: session cookie

Email + password, password hashed with Argon2id, server-side sessions in PostgreSQL,
`HttpOnly` `Secure` `SameSite=Lax` cookie, implemented with Better Auth.

Both paths resolve to the same internal `Actor { accountId, kind, role, permissions }`, and
every service function takes an `Actor`. There is one permission system, not two.

## 5. Bug report contract

`POST /api/v1/projects/{projectId}/bug-reports` (scope `reports:write`)

```jsonc
{
  "title": "Checkout button returns 500", // required
  "originLayer": "api", // frontend | api | backend | unknown
  "confidence": 0.8, // 0..1, agent's confidence in originLayer
  "severity": "high", // low | medium | high | critical
  "fingerprint": "a3f1...", // required, opaque, max 128 chars
  "summary": "Markdown description of the bug",
  "evidence": {
    "stepsToReproduce": ["..."],
    "expected": "...",
    "actual": "...",
    "url": "https://app.example.com/checkout",
    "http": { "method": "POST", "path": "/api/orders", "status": 500, "responseSnippet": "..." },
    "consoleErrors": ["..."],
    "diagnosis": "Why the agent believes this layer is at fault",
  },
  "runId": "optional id grouping reports from one test run",
}
```

Responses:

- `201` `{ "outcome": "created", "taskId", "assignedTeamId" }`
- `200` `{ "outcome": "deduplicated", "taskId", "occurrences" }`
- `400` invalid payload, `401`/`403` auth, `404` unknown project, `429` rate limited.

Evidence is text/JSON only in v1, size-capped. File attachments are out of v1.

### Origin layers

| Layer      | Meaning (guidance published to agent authors)                                                    |
| ---------- | ------------------------------------------------------------------------------------------------ |
| `frontend` | Rendering, client-side logic or UI state is wrong while API responses are correct                |
| `api`      | The HTTP contract is violated: wrong status, schema, validation, auth handling                   |
| `backend`  | The contract is honored but the outcome is wrong: data, business logic, jobs, 5xx from internals |
| `unknown`  | The agent cannot tell                                                                            |

The layer set is fixed in v1. Teams are configurable; layers are not.

## 6. Triage pipeline (server side)

In one database transaction:

1. **Persist** the raw report in `bug_reports` (always, even when deduplicated).
2. **Dedupe**: look for a task in the same project with the same fingerprint that is not
   in a column of the `done` category (doc 0003, section 5).
   - Found: link the report, increment the task's `occurrences`, update
     `last_reported_at`, add a system comment. No new ticket, no reassignment.
   - Not found: continue. A matching _closed_ task does not block creation; the new task
     gets a `regression of` link to it (doc 0003, section 7).
3. **Route**: look up `routing_rules(project_id, origin_layer) -> team_id`.
   - `unknown`, or no rule for the layer: use the project's fallback triage team.
4. **Create** a task of type `bug`, placed in the project's first column, or at the top of
   the backlog if the project uses sprints (doc 0003), with `assignee_team_id` set, `reporter_account_id` set to the agent, and the report rendered into the body.
5. **Audit**: record the action against the agent's account.

A unique partial index on `(project_id, fingerprint)` for open tasks makes dedupe safe
under concurrent reports.

Fingerprints are computed by the agent and opaque to Opanel. Published guidance:
hash of `originLayer + normalized route or endpoint + error signature`, excluding
timestamps, ids and other volatile values.

Tickets are assigned to a **team**, not a person. Team members self-assign or a human
triages within the team. Humans can always re-route a ticket; that does not change the
routing rules. Routing rules and teams are managed by Managers and Admins.

## 7. Data model sketch

Not a final schema; work-specs define columns and migrations.

```
accounts(id, kind, name, email?, role, disabled_at, last_seen_at, created_by?, ...)
credentials(id, account_id, provider_id, provider_account_id, password_hash?, ...)
verification(id, identifier, value, expires_at, ...)   unused in v1, required by Better Auth
rate_limits(key, count, window_started_at)             sign-in limiter counters
account_tokens(id, account_id, kind, token_hash, expires_at, used_at?, created_by, ...)
                                                       one-time invitation and reset links, hash only
agent_scopes(account_id, scope)            agent_projects(account_id, project_id)
api_tokens(id, account_id, public_id, secret_hash, expires_at?, revoked_at?, last_used_at)
sessions(id, account_id, token, expires_at, ...)
teams(id, name)                             team_members(team_id, account_id)
projects(id, key, name, fallback_team_id)
columns(id, project_id, name, position, category)
epics(id, project_id, title, ...)
tasks(id, project_id, epic_id?, column_id, type, title, body, severity?,
      assignee_team_id?, assignee_account_id?, reporter_account_id,
      fingerprint?, occurrences, last_reported_at?)
task_links(from_task_id, to_task_id, type)
comments(id, task_id, author_account_id?, kind, body)
routing_rules(project_id, origin_layer, team_id)
bug_reports(id, project_id, agent_account_id, task_id, payload, created_at)
audit_log(id, actor_account_id?, action, entity, entity_id?, data?, created_at)   append-only
```

A **project** is the unit under test. Dogfooding means creating a project named "Opanel"
with its own routing rules. No separate "test target" entity is introduced.

## 8. Resolved questions

Decided with the owner on 2026-11-12:

1. **Human auth library:** Better Auth (email/password, Drizzle adapter, sessions in
   PostgreSQL). Agent API tokens remain a custom implementation as described in section 4.
2. **Agents testing Opanel's own UI:** agents get no UI login. For dogfooding, the agent
   operator uses an ordinary human test account on a staging install for browser flows,
   and the agent token only for filing reports.
3. **Attachments:** evidence is text/JSON only in v1. File attachments are a later
   work-track.
4. **Live board updates:** required in v1 so several members can work on a board at the
   same time. Design in canonical doc [0002](0002-realtime-sync.md).
5. **Columns:** configurable per project, with one or more flagged as "done".
6. **Notifications:** out of v1.

## 9. Explicitly out of scope

- Running, scheduling or hosting agents; any LLM call inside Opanel.
- Server-side classification of the origin layer.
- Multi-organization tenancy, OAuth/SSO.
- File attachments, notifications (email, webhooks).
- A reference QA agent implementation (can become its own work-track later).
