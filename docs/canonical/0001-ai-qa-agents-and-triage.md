# 0001 — AI QA agents: identity, authentication and automated triage

- Status: **Approved** (2026-11-12)
- Date: 2026-11-12
- Supersedes: none
- Amended by: [0003](0003-task-management.md), section 12 (applied 2026-11-12); [WT-03](../work-tracks/WT-03-board-core.md) decision 17 (`projects:read` lists people, 2026-11-13); [WT-05](../work-tracks/WT-05-agent-accounts-and-tokens.md) decisions 1, 7 and 11 (scopes, project restrictions, no deletion; applied 2026-11-19 by WI-071; the order of refusals for a restricted agent, 2026-11-19 by WI-073); [WT-06](../work-tracks/WT-06-bug-reports-and-triage.md) decisions 3, 6, 9, 10 and 13 (the answers, dedupe, routing with no team, regression links, repeat comments; applied 2026-11-20 by WI-094)

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
- **Agent account**: unique name (among agents, in any letter case), description, role,
  set of scopes, project restriction, owning human (the admin who created it),
  `disabled_at`, `last_seen_at`. No email, no password.

Agents are created, disabled and re-enabled only by human admins. They are not deleted in
v1: tasks, their history and the audit log keep pointing at them (WT-05 decision 11). An
agent can never create accounts or tokens.

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

An agent's role is the preset its scopes start from. An Admin may remove scopes from an
agent, never add one its role does not include, and endpoints check the stored scopes
(WT-05 decision 1). No agent can hold a `*:manage` or delete permission: the database
refuses any scope outside the table above (WI-071).

Initial agent roles:

- `qa_agent`: `projects:read`, `tasks:read`, `reports:write`, `comments:write`.
- `worker_agent` (reserved for later, e.g. agents that fix tickets): adds `tasks:write`.

An agent can additionally be restricted to specific projects: it has either all projects
or the listed ones, even when the list is empty (`all_projects`, WI-071).

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
- An agent restricted to projects gets `403` for another project and for anything inside
  it, after an unknown id's `404` and before any other refusal (such as an archived
  project's `409`), so it learns nothing of that project's state; lists of projects leave
  the others out (WS-073).
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

`originLayer` defaults to `unknown` and `severity` to `medium`; only `title` and
`fingerprint` are required. Every field is bounded by the request schema
(`SubmitBugReportRequest` in the OpenAPI document, WS-089 section 1), and unknown fields
are refused.

Responses:

- `201` `{ "outcome": "created", "taskId", "taskKey", "assignedTeamId" }`;
  `assignedTeamId` is `null` when no team owns the layer (section 6).
- `200` `{ "outcome": "deduplicated", "taskId", "taskKey", "occurrences" }`.
- `400` invalid payload, `401`/`403` auth, `404` unknown project, `409 project_archived`,
  `413` body over 512 KiB, `415` not JSON, `429` rate limited.

`taskKey` (for example `OPA-12`) was added by WT-06 decision 13, for agents and people
reading logs. Only agents hold `reports:write`, so a person gets `403`; a person files a
bug by creating a task of type `bug`.

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

1. **Lock**: take `pg_advisory_xact_lock` on the project and fingerprint, so reports with
   the same fingerprint in a project run one after another (see "Concurrency" below).
2. **Dedupe**: look for an _open_ task in the same project with the same fingerprint: not
   deleted, and not in a column of the `done` category (doc 0003, section 5). Its type
   does not matter: a bug a person changed to another type still counts (WS-089).
   - Found: increment the task's `occurrences`, update `last_reported_at`, record
     `reported_again` in its history. No new ticket; column, team, assignee and severity
     stay as they are. A system comment is added only when the previous report on the
     task is more than an hour old or came with another `runId` (WT-06 decision 10), so
     an agent that runs every few minutes does not bury the task's comments.
   - Not found: continue. A matching _closed_ task (same fingerprint, not deleted, in a
     `done` column) does not block creation; the new task gets a `regression_of` link to
     the most recently updated one (doc 0003, section 7), and its first comment names it.
     A soft-deleted task is neither matched nor linked: a report about it creates a new
     task (WT-06 decision 9).
3. **Route**: look up `routing_rules(project_id, origin_layer) -> team_id`.
   - `unknown`, or no rule for the layer: use the project's triage team
     (`projects.triage_team_id`).
   - Neither: the bug is created with no team, and its first system comment says that no
     team owns the layer, so a person triages it from the board. The report is never
     refused for a gap in the project's configuration (WT-06 decision 3).
4. **Create** a task of type `bug` at the top of the project's first column, or at the top
   of the backlog if the project uses sprints (doc 0003), with `assignee_team_id` set
   (or none, step 3), `reporter_account_id` set to the agent, the report's severity,
   `occurrences = 1`, and the summary and evidence rendered into the description, each
   value in a fenced block so a report cannot inject Markdown structure. One function,
   `placeNewBug`, decides the place; WT-10 changes it for sprint projects.
5. **Persist** the report in `bug_reports` as sent, with its outcome and task (always,
   even when deduplicated). The table is append-only for the runtime role.
6. **Audit**: `bug_report.triaged` with the report, the task, the outcome and the team,
   against the agent's account; the task's history records `created` or
   `reported_again` with the agent as actor.

**Concurrency.** Dedupe is serialised by the advisory lock of step 1, not by a unique
index: whether a task is open depends on its column's category, which a partial index on
`tasks` cannot see (WT-06 decision 6). A non-unique index on `(project_id, fingerprint)`
keeps the lookup fast. Ten identical reports sent at once leave one task with
`occurrences` 10. One narrow window is accepted (WS-089): a person who closes or deletes
the open task between the lookup and its row lock gets the repeat counted on it; the
report is kept either way.

Fingerprints are computed by the agent and opaque to Opanel. Published guidance:
hash of `originLayer + normalized route or endpoint + error signature`, excluding
timestamps, ids and other volatile values.

Tickets are assigned to a **team**, not a person. Team members self-assign or a human
triages within the team. Humans can always re-route a ticket; that does not change the
routing rules. Routing rules and teams are managed by Managers and Admins (`teams:manage`):
`GET`/`PATCH /api/v1/projects/{projectId}/triage` and the project's "Triage" settings
section. Anyone with `projects:read`, agents included, may read them.

## 7. Data model sketch

Not a final schema; work-specs define columns and migrations.

```
accounts(id, kind, name, email?, role, description?, all_projects?, disabled_at,
         last_seen_at, created_by?, ...)            description and all_projects: agents only
credentials(id, account_id, provider_id, provider_account_id, password_hash?, ...)
verification(id, identifier, value, expires_at, ...)   unused in v1, required by Better Auth
rate_limits(key, count, window_started_at)             sign-in limiter counters
account_tokens(id, account_id, kind, token_hash, expires_at, used_at?, created_by, ...)
                                                       one-time invitation and reset links, hash only
agent_scopes(account_id, scope)            agent_projects(account_id, project_id)
                                           both for agent accounts only (WI-071)
api_tokens(id, account_id, public_id, secret_hash, name, created_by?, created_at,
           expires_at?, revoked_at?, last_used_at?)
sessions(id, account_id, token, expires_at, ...)
teams(id, name)                             team_members(team_id, account_id)
projects(id, key, name, triage_team_id?, version, ...)
columns(id, project_id, name, position, category)
epics(id, project_id, title, ...)
tasks(id, project_id, epic_id?, column_id, type, title, body, severity?,
      assignee_team_id?, assignee_account_id?, reporter_account_id,
      fingerprint?, occurrences, last_reported_at?, version, deleted_at?, ...)
task_links(from_task_id, to_task_id, type, created_by?, created_at)
                                            type: regression_of only until WT-09
comments(id, task_id, author_account_id?, kind, body)
routing_rules(project_id, origin_layer, team_id)
bug_reports(id, project_id, agent_account_id, task_id, outcome, origin_layer,
            confidence?, severity, fingerprint, run_id?, payload, created_at)   append-only
audit_log(id, actor_account_id?, action, entity, entity_id?, data?, created_at)   append-only
```

Sign-in and sign-out are audited atomically with what the API answers: a `2xx` sign-in has
its `auth.sign_in` entry, and a sign-out's session delete and `auth.sign_out` entry are one
transaction. Better Auth inserts a session in its own statement, so a process that stops
between that insert and the audit transaction can leave an unaudited session whose cookie
was never sent; it expires with the session lifetime (7 days). A sign-in made while the
account's password changes does not survive the change (WS-058).

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
