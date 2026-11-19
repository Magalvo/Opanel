# WT-05 — Agent accounts and API tokens

- Status: In progress (approved by the owner on 2026-11-19: decisions 1 to 14 and
  questions 1 to 6 as proposed; item A done on 2026-11-19)
- Canonical docs: [0001](../canonical/0001-ai-qa-agents-and-triage.md) (sections 3 and 4:
  identity, scopes, tokens; amended by this track, see decision 1),
  [0003](../canonical/0003-task-management.md) (section 3: only Admins manage agents),
  [0004](../canonical/0004-api-conventions.md) (section 7: bearer authentication, `401`
  and `403`), [0002](../canonical/0002-realtime-sync.md) (the events stream accepts agent
  tokens), [0005](../canonical/0005-mcp-server.md) (WT-11 needs `GET /me` for agents)

## Goal

An Admin creates an agent account, gives it a role, its scopes and optionally a list of
projects, and issues it API tokens, each shown once. An external program calls `/api/v1`
with `Authorization: Bearer <token>` and gets exactly what its scopes and projects allow,
every action attributed to the agent. Tokens can be rotated and revoked, and agents
disabled, from the UI and the API, each change audited.

## Depends on

- **WT-02** (accounts, the permission layer): `Actor`, `authenticate()`, the `route()`
  wrapper, the audit log.
- **WT-03** and **WT-04**: the endpoints agents call, and the events stream.
- **WT-12**: done; nothing in this track changes the operations guide except one line on
  token-authenticated rate limiting (decision 8).

## Starting point

WT-02 and WT-03 prepared the ground:

- `accounts` already has `kind` (`human` | `agent`), `disabled_at`, `last_seen_at` and
  `created_by`; only human rows have a role check (`accounts_human_role_check`).
- `Actor` is `kind: "human"` only, and `src/server/auth/actor.ts` says WT-05 adds the
  `"agent"` member. Every service checks permissions through `Actor`.
- `authenticate()` rejects any request with an `Authorization` header (`401`) and never
  tries the cookie then (doc 0004 section 7). The same-origin check already exempts such
  requests (`src/server/auth/origin.ts`).
- The permission catalogue (`src/lib/schemas/permissions.ts`) already holds the five agent
  scopes and `agents:manage`, which only Admins have.
- The people directory, assignment and team membership already exclude agents
  (`isPerson`), and an agent has no credentials, so it cannot sign in. `GET /me` already
  returns `kind`.
- The OpenAPI document shows each operation's permission (`x-opanel-permission`), but no
  bearer security scheme yet (a Follow-up of `docs/README.md`).
- The events stream re-authenticates on every heartbeat (WT-04 decision 6), so a revoked
  token or a disabled agent loses its stream within 25 seconds with no change there.

## In scope

- The data model: agent roles, scopes and project restrictions; `api_tokens`.
- Issuing, verifying, rotating and revoking tokens; `authenticate()` accepting them.
- The agent `Actor`, and project restrictions enforced by the services.
- The Admin API for agents and their tokens, audited.
- `GET /api/v1/me` for agents (what WT-11 needs); the other authentication-only operations
  refusing agents.
- Rate limiting per token.
- An **Agents** page for Admins.
- How agents appear where humans see them: reporter, comment author, history.
- The bearer security scheme in the OpenAPI document, and a short guide for agent authors.

## Out of scope

- Bug reports and triage (WT-06), the MCP server (WT-11).
- Agents as assignees: tasks are assigned to teams or people; an agent is never offered
  in an assignee picker (decision 10).
- Per-project roles for humans (doc 0003, question 2).
- Token expiry notifications (no notifications in v1).
- OAuth, client credentials or any other token flow (doc 0001 section 9).

## Design decisions

Choices the canonical docs leave open. Each is detailed in the work-spec of the item that
implements it.

1. **An agent's permissions are its scopes; its role is the preset they start from.** Doc
   0001 gives an agent both "role" and "set of scopes" without saying how they relate.
   Proposal: the role (`qa_agent` or `worker_agent`) is stored and shown, and fills the
   scopes when the agent is created; the Admin may then remove scopes, never add one the
   role lacks. What endpoints check is the stored scopes (`agent_scopes`). Allowed scopes
   are exactly the five of doc 0001 section 3; any `*:manage` or `tasks:delete_*`
   permission is refused by the schema and by a database check, so an agent can never
   manage accounts or tokens (doc 0001 section 3). This is written into doc 0001 as an
   amendment by item A.

2. **Agent rows in `accounts`.** `name` is unique among agents (case-insensitive), 1 to 80
   characters; `email` stays null; `role` is checked as `qa_agent | worker_agent` for
   agent rows. A `description` column (up to 500 characters, nullable) is added for
   agents. `created_by` is the Admin who created it.

3. **Token format and storage, as doc 0001 section 4.**
   `opk_<publicId>_<secret>`: `publicId` is 12 characters of lowercase base32 (60 bits,
   unique, the lookup key); `secret` is 32 bytes from `crypto.randomBytes`, as 64 hex
   characters, so neither part contains `_`. Stored: `public_id`, `SHA-256(secret)`, a
   `name` the Admin gives the token ("CI runner"), `created_by`, `expires_at?`,
   `revoked_at?`, `last_used_at?`. The secret is compared with `crypto.timingSafeEqual`
   over the digests. The full token appears only in the `201` response that creates it,
   never in a log, the audit log or another response (hard rule 7).

4. **Expiry chosen by the Admin, 90 days by default.** Options: 30, 90 or 365 days, or no
   expiry. An expired token is a `401` like an unknown one. At most 10 unrevoked,
   unexpired tokens per agent (`409` with code `too_many_tokens`), enough to rotate
   without downtime.

5. **What `authenticate()` checks for a bearer token, in order:** the header has the
   format (else `401`); a row with that `publicId` exists (else `401`); the secret's
   digest matches; the token is neither revoked nor expired; the account is an agent and
   not disabled. Every failure is the same `401` (doc 0004 section 4). A bearer token
   never falls back to the cookie.

6. **`last_used_at` and `last_seen_at` are written at most once a minute per token.** A
   write per request would double the database work of an agent that polls. The update
   is a single conditional statement (`where last_used_at is null or last_used_at <
now() - interval '1 minute'`), outside the request's own transaction.

7. **Project restrictions are enforced in the services, not in `route()`.** The agent
   `Actor` carries `projectIds: ReadonlySet<string> | null` (`null` means all projects).
   One helper, `requireProjectAccess(actor, projectId)`, is called by every service that
   takes a project, task, column, epic or comment, after it has resolved the project; a
   restricted agent gets `403` there, as doc 0001 section 4 says. Lists of projects are
   filtered instead of refused. Teams and people are not project-scoped and stay visible
   with `projects:read`. A test lists every service function that takes a project-scoped
   id and fails if one does not call the helper, in the way WS-025 checks access
   declarations.

8. **Rate limiting per token: 600 requests a minute, in the app process.** A fixed
   window counted in memory, keyed by token id. Above it: `429` with code `rate_limited`
   and `Retry-After` (doc 0004). In memory rather than in `rate_limits`: v1 runs one app
   process (doc 0006 section 3), and a database write per request is what decision 6
   avoids. The events stream counts once when it opens, not per event. The operations
   guide gains one line.

9. **`GET /api/v1/me` for an agent** returns `kind: "agent"`, `id`, `name`, `role`,
   `permissions` (its scopes) and `projectIds` (`null` for all), the fields WT-11 reads.
   The other authentication-only operations (`PATCH /me`, `POST /me/password`,
   `POST /auth/sign-out`) answer `403` to an agent: an agent has no profile to edit, no
   password and no session. Human responses of `GET /me` are unchanged, apart from
   `projectIds: null`, an additive field.

10. **How agents appear.** As reporter, comment author and in history, an agent shows its
    name with an "Agent" badge, from data the API already returns, adding `kind` to an
    account summary that lacks it (an additive field). Agents are not people (`isPerson`): never in
    the people directory, team membership or assignee pickers.

11. **No hard delete of an agent in v1.** Doc 0001 says Admins "delete" agents, but an
    agent is the reporter of tasks and the actor of history and audit entries, which must
    keep pointing at it. Proposal: **disable** (revokes nothing, but every token stops
    working at once through decision 5) and **re-enable**. A disabled agent's tokens can
    still be revoked. Deleting becomes a Follow-up if ever needed.

12. **Audit entries**, with the acting Admin: `agent.created`, `agent.updated` (name,
    description, scopes or projects; `data` lists the changed fields, never values that
    could be secret), `agent.disabled`, `agent.reenabled`, `agent.token_created` and
    `agent.token_revoked` (`data`: token id, name, expiry; never the token). A token's use
    is not audited; its effect is, as the agent's own task history and audit entries.

13. **The Agents page** (`/agents`, Admins only, linked from the navigation next to
    People): the list of agents (name, role, status, last seen); a dialog to create one;
    an agent's page with its scopes, projects and tokens; "Create token" shows the token
    once in a dialog with a copy button and the sentence that it will not be shown again;
    "Revoke" with a confirmation. Built with the components the People page uses.

14. **The OpenAPI document declares the bearer scheme** (`bearerAuth`, `http`, `bearer`)
    next to the cookie, on every non-public operation, closing the Follow-up of
    `docs/README.md`. Each operation already shows its permission.

## Work-items (outline)

Numbers are given in order when each item starts; each gets its work-spec then.

| Item                                                     | Title                                                                                                        | Status   | Depends on |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------- | ---------- |
| [WI-071](../work-items/WI-071-agent-data-model.md) A     | Data model: agent rows, roles and scopes, project restrictions, `api_tokens`; the agent `Actor`; doc 0001    | Done     | WT-04      |
| [WI-072](../work-items/WI-072-api-tokens.md) B           | Token issuing and verification; `authenticate()` accepts bearer tokens; `last_used_at`; per-token rate limit | Done     | A          |
| [WI-075](../work-items/WI-075-agents-admin-api.md) C     | Admin API for agents and tokens, audited; the bearer scheme in the OpenAPI document                          | Done     | B          |
| [WI-073](../work-items/WI-073-project-restrictions.md) D | Project restrictions enforced in every service, with the coverage test                                       | Done     | A          |
| [WI-076](../work-items/WI-076-me-for-agents.md) E        | `GET /me` for agents; the other authentication-only operations refuse them                                   | Done     | B          |
| [WI-077](../work-items/WI-077-agents-page.md) F          | The Agents page                                                                                              | Proposed | C          |
| [WI-074](../work-items/WI-074-agent-badge.md) G          | Agents where humans see them: the "Agent" badge on reporter, author and history                              | Done     | A          |
| H                                                        | End-to-end agent flow and the guide for agent authors (`docs/agents.md`)                                     | Draft    | C, D, E, F |

## Exit criteria

- [ ] An Admin creates an agent and a token from the Agents page; the token is shown once
      and works at once with `Authorization: Bearer`.
- [ ] A token reaches exactly its agent's scopes: an endpoint needing another permission
      answers `403`; an unknown, malformed, expired or revoked token, or one of a disabled
      agent, answers the same `401`.
- [ ] A restricted agent reads and writes only its projects: other projects are missing
      from lists and answer `403` everywhere else; the coverage test passes.
- [ ] No agent can hold a `*:manage` or delete permission; a test tries each through the
      API and the database.
- [ ] Every action of an agent is attributed to it in the task history or the audit log;
      every Admin action on agents and tokens is audited, never with the token.
- [ ] An agent's events stream closes within one heartbeat of its token's revocation or
      the agent being disabled.
- [ ] Above 600 requests a minute a token gets `429` with `Retry-After`.
- [ ] `GET /me` with a token returns what WT-11 needs; the OpenAPI document declares the
      bearer scheme.
- [ ] The full quality gate passes; an end-to-end test drives the whole flow.

## Risks and open questions

For the owner (decisions 1 to 14 are each approved or changed; these need an explicit
answer):

1. **Scopes as a subset of the role** (decision 1), rather than scopes fixed by the role
   (simpler, but no way to give a QA agent read-only access) or free scopes with the role
   as a label only. **Recommend: subset of the role.**
2. **No hard delete** (decision 11), contrary to the word "deleted" in doc 0001 section 3,
   which the amendment of item A would change to "disabled". **Recommend: disable only.**
3. **Default expiry 90 days, and "no expiry" allowed** (decision 4). The alternative is to
   forbid tokens without expiry. **Recommend: allow it, default 90 days.**
4. **Rate limit in memory, 600 a minute** (decision 8). Lost on restart and not shared
   between processes, both acceptable while v1 runs one process. **Recommend: as
   proposed.**
5. **`403` for another project's resources** (decision 7), as doc 0001 says, rather than
   `404`, which would hide that the project exists. Project names are not secret inside
   one organization. **Recommend: `403`, as written.**
6. **Track order:** WT-05 now, then WT-06, then WT-11, as `docs/README.md` plans.
   **Recommend: as planned.**

Risks:

- **Decision 7 touches every service.** Item D is the largest; the coverage test is what
  keeps a future endpoint from forgetting the check. WT-06 to WT-10 add services that must
  call the helper too, and their work-specs must say so.
- **Unauthenticated work per request**: a malformed bearer token is refused before any
  database access; a well-formed one costs one indexed lookup and one SHA-256.
