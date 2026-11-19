# WS-075 — The Admin API for agents and their tokens

- Status: Proposed
- Work-item: [WI-075](../work-items/WI-075-agents-admin-api.md)
- Canonical docs: [0001](../canonical/0001-ai-qa-agents-and-triage.md) (sections 3 and 4);
  [0004](../canonical/0004-api-conventions.md) (errors, lists, writes, versioning);
  [WT-05](../work-tracks/WT-05-agent-accounts-and-tokens.md) (decisions 1 to 4, 11, 12
  and 14); [WS-071](WS-071-agent-data-model.md) (the tables);
  [WS-072](WS-072-api-tokens.md) (`generateApiToken`, the `session` access kind);
  AGENTS.md hard rules 6 to 9

## Approach

### 1. Where things stand (checked on 2026-11-19, `main` at `08a27f0`)

- The tables `accounts` (agent rows), `agent_scopes`, `agent_projects` and `api_tokens`
  exist, and the database refuses anything outside WT-05's rules (WS-071).
- `generateApiToken()` and `authenticate()` with tokens exist (WS-072), as do project
  restrictions in the services (WS-073) and the Agent badge (WS-074).
- Nothing creates an agent or a token outside the tests (`createTestAgent`,
  `createTestToken`).
- The human-accounts API (`src/lib/schemas/accounts.ts`, `account-management.ts`) is the
  model for this one: `accounts:manage`, problem codes, one audit entry per change in the
  change's transaction. Humans have no `version`, and neither do agents (open question 2).
- `recordAudit` refuses any `data` key matching `/token|secret|hash|…/` (hard rule 7). The
  token entries therefore use `entity: "api_token"` with the token's id as `entityId`, and
  `data` has no key with "token" in it.
- The OpenAPI document declares only the session cookie scheme. Its comment says the
  bearer scheme comes with tokens, in WT-05.

### 2. Endpoints

All of them use `access: { kind: "permission", permission: "agents:manage" }`.

| Operation       | Path                                               | Success                                                                                                               |
| --------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| List agents     | `GET /api/v1/agents`                               | `200` `AgentPage`, ordered by name like the people list (`lower(name)` in `"C"` collation, then id; cursor as WS-026) |
| Create an agent | `POST /api/v1/agents`                              | `201` `Agent`                                                                                                         |
| Read an agent   | `GET /api/v1/agents/{agentId}`                     | `200` `Agent`                                                                                                         |
| Change an agent | `PATCH /api/v1/agents/{agentId}`                   | `200` `Agent`                                                                                                         |
| List its tokens | `GET /api/v1/agents/{agentId}/tokens`              | `200` `{ items: ApiToken[], nextCursor: null }`, newest first: a small, bounded list (doc 0004 section 5)             |
| Create a token  | `POST /api/v1/agents/{agentId}/tokens`             | `201` `CreatedApiToken`                                                                                               |
| Revoke a token  | `DELETE /api/v1/agents/{agentId}/tokens/{tokenId}` | `204`                                                                                                                 |

An unknown agent, a human's id, or a token of another agent answers `404 not_found`.

### 3. Schemas: `src/lib/schemas/agents.ts`

```ts
Agent = {
  id, name,
  description: string | null,
  role: "qa_agent" | "worker_agent",
  scopes: AgentScope[],            // sorted
  projectIds: string[] | null,     // null: all projects
  status: "active" | "disabled",
  createdAt, lastSeenAt: string | null,
}

CreateAgentRequest = strict {
  name: 1..80, trimmed,
  description?: 1..500 | null,
  role,
  scopes?: AgentScope[],           // default: every scope of the role
  projectIds: uuid[] | null,       // required: the Admin chooses, never a silent "all"
}

UpdateAgentRequest = strict, at least one field {
  name?, description?, role?, scopes?, projectIds?,
  active?: boolean,                // false disables, true re-enables
}

ApiToken = {
  id, name, createdAt,
  expiresAt: string | null,
  lastUsedAt: string | null,
  revokedAt: string | null,
  status: "active" | "expired" | "revoked",
}

CreateApiTokenRequest = strict {
  name: 1..80, trimmed,
  expiresInDays?: 30 | 90 | 365 | null,   // default 90; null: no expiry
}

CreatedApiToken = { token: string /* opk_…, shown once */, apiToken: ApiToken }
```

Validation that needs the role is a `superRefine` on the request, plus a check in the
service against the stored role for a `PATCH`:

- scopes must be within the role, and duplicates are refused;
- `projectIds` must be unique;
- an unknown project id is a `400` with the field error `projectIds` (service check).

### 4. Service: `src/server/services/agents.ts`

`loadAgentActor` exists. The new functions each take the Admin `Actor`, call
`requirePermission(actor, "agents:manage")`, run in one transaction, and write their
audit entry in it:

- `listAgents(actor, query)` and `getAgent(actor, id)`.
- `createAgent(actor, body)`: inserts the account (`kind: 'agent'`,
  `all_projects = projectIds === null`, `created_by`), its scopes and its projects. The
  unique-name violation (`accounts_agent_name_lower_idx`) becomes the `409` code
  `agent_name_taken`. Audit: `agent.created`, with `data: { role, scopes, projectIds }`.
- `updateAgent(actor, id, body)`:
  - locks the row (`for update`);
  - a role change without `scopes` keeps the scopes that the new role allows;
  - replaces scopes and projects when they are given;
  - `active: false` sets `disabled_at` and `active: true` clears it.
  - Audit: one `agent.updated` with `data.fields` (the names of the changed fields) when
    any field other than `active` changed, then `agent.disabled` or `agent.reenabled`
    when `active` changed. A request that changes nothing writes nothing.
- `listApiTokens(actor, agentId)`. The status is computed in SQL: `revoked` when
  `revoked_at` is set, else `expired` when `expires_at <= now()`, else `active`.
- `createApiToken(actor, agentId, body)`:
  - locks the agent row;
  - refuses a disabled agent with `409 agent_disabled`;
  - counts usable tokens, and at 10 refuses with `409 too_many_tokens`;
  - stores `generateApiToken()` with `created_by` and the expiry, and returns the token
    once.
  - Audit: `agent.token_created`, with `entity: "api_token"`, the token id as
    `entityId`, and `data: { agentId, name, expiresAt }`.
- `revokeApiToken(actor, agentId, tokenId)`: sets `revoked_at` if it is null. Audit:
  `agent.token_revoked`, the same way. An already revoked token answers `204` with no
  second entry.

### 5. Errors (`src/server/http/errors.ts`) and doc 0004

There are three new codes, all `409`: `agent_name_taken`, `too_many_tokens` and
`agent_disabled`. They are added to the list of specific codes in doc 0004 section 4. The
audit catalogue (`src/lib/schemas/audit.ts`) gains the six actions.

### 6. OpenAPI: the bearer scheme (WT-05 decision 14)

- `components.securitySchemes.bearerAuth = { type: "http", scheme: "bearer",
description: "An agent's API token, opk_…, created by an Admin (doc 0001 section 4)." }`.
- `security` per operation:
  - public: `[]`;
  - `session`: `[{ sessionCookie: [] }]`;
  - everything else: `[{ sessionCookie: [] }, { bearerAuth: [] }]` (either one).
- The comment saying the scheme "is declared together with tokens, in WT-05" is updated.
  `docs/api/openapi.json` is regenerated. This closes the Follow-up "Declare the
  bearer-token security scheme in the OpenAPI document with WT-05".

### 7. Routes

These are thin handlers, as `src/app/api/v1/accounts/` does:

- `src/app/api/v1/agents/route.ts` (`GET`, `POST`);
- `src/app/api/v1/agents/[agentId]/route.ts` (`GET`, `PATCH`);
- `src/app/api/v1/agents/[agentId]/tokens/route.ts` (`GET`, `POST`);
- `src/app/api/v1/agents/[agentId]/tokens/[tokenId]/route.ts` (`DELETE`).

The contracts are registered in `src/lib/openapi/contracts.ts`.

### Considered and not chosen

- **Deleting agents**: WT-05 decision 11 (disable only).
- **Returning the token on the token list**: it is stored only as a hash, and shown once
  (doc 0001).
- **A separate `/api/v1/api-tokens` collection**: tokens always belong to one agent, and
  nesting keeps `404` for a token of another agent trivial.

## Files

| Path                                                                    | Change                                       |
| ----------------------------------------------------------------------- | -------------------------------------------- |
| `src/lib/schemas/agents.ts` (+ unit test)                               | create: section 3, the contracts             |
| `src/lib/schemas/audit.ts` (+ test)                                     | modify: six actions                          |
| `src/lib/openapi/contracts.ts`, `src/lib/openapi/document.ts` (+ tests) | modify: register; bearer scheme (section 6)  |
| `src/server/http/errors.ts` (+ test)                                    | modify: three errors                         |
| `src/server/services/agents.ts` (+ integration test)                    | modify: section 4                            |
| `src/app/api/v1/agents/**/route.ts` (+ integration tests)               | create: section 7                            |
| `src/server/auth/testing.ts`                                            | modify only if a helper is needed            |
| `docs/api/openapi.json`                                                 | regenerate                                   |
| `docs/canonical/0004-api-conventions.md`                                | modify: the three codes                      |
| `docs/README.md`, WT-05, WI-075, WS-075                                 | modify: statuses; close the bearer Follow-up |

## Data model changes

None. The tables exist (WI-071).

## API contract

Section 2, with the schemas of section 3. All additive. The new `409` codes are
`agent_name_taken`, `too_many_tokens` and `agent_disabled`. The OpenAPI document gains
`bearerAuth` (section 6).

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                                                                                                                                     | Covers criterion |
| --- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit        | `createAgentRequestSchema`: name trimming and length; a scope outside the role, or a duplicate scope, is refused with the field error; `projectIds` is required, unique, and nullable; unknown fields are refused                                                                        | 2                |
| 2   | unit        | `updateAgentRequestSchema`: needs one field; `active` boolean; same scope rules when `role` and `scopes` are both sent                                                                                                                                                                   | 3                |
| 3   | unit        | `createApiTokenRequestSchema`: `expiresInDays` only 30, 90, 365 or null; default 90                                                                                                                                                                                                      | 4                |
| 4   | unit        | the audit actions are in the catalogue; the OpenAPI document has `bearerAuth`; a `session` operation lists only the cookie, a permission operation lists both, a public one none                                                                                                         | 6, 7             |
| 5   | integration | `createAgent`: the default scopes are the role's; restricted, all-projects and no-project agents round-trip through `getAgent`; an unknown project id gives `400 projectIds`; a duplicate name in another case gives `409 agent_name_taken`; one `agent.created` with the Admin as actor | 2, 6             |
| 6   | integration | `updateAgent`: rename; a role change that drops a scope; replacing projects; `active: false` makes the agent's token `401` at once and `active: true` makes it work again; the audit entries are as section 4 says; an empty change writes nothing                                       | 3, 6             |
| 7   | integration | `createApiToken`: the token authenticates; the default expiry is 90 days and `null` means none; the 11th usable token is `409 too_many_tokens`, while an expired or revoked one does not count; a disabled agent gets `409 agent_disabled`; two concurrent creates at 9 leave exactly 10 | 4                |
| 8   | integration | `listApiTokens` and `revokeApiToken`: the three statuses; no `secretHash`, `publicId` or `token` key in any item; after revoking, the token is `401` at once; a second revoke is `204` with no second audit; another agent's token is `404`                                              | 5, 6             |
| 9   | integration | no audit row contains the token, its secret or its hash (search the `data` of every row written by tests 5 to 8)                                                                                                                                                                         | 6                |
| 10  | integration | through the routes: a Manager gets `403` on all seven operations; an agent token holding every agent scope gets `403`; an Admin gets the documented status for each; a non-uuid path is `400`, an unknown id `404`                                                                       | 1                |
| 11  | integration | the route-access and OpenAPI document tests with the new contracts; `docs/api/openapi.json` matches                                                                                                                                                                                      | 7, 8             |
| 12  | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`                                                                                                                                                                                                                                  | 8                |

## Risks and open questions

For the owner:

1. **`projectIds` is required on create**, with `null` for all projects, rather than
   defaulting to all. The Admin then always makes an explicit choice about reach.
   **Recommend: required.**
2. **No `version` on agents**, like human accounts. Admins rarely edit the same agent at
   once, and a `PATCH` replaces only the fields it sends. **Recommend: no version.**
3. **A role change without `scopes` keeps the scopes the new role allows**, rather than
   resetting to the new role's full set. Changing `worker_agent` to `qa_agent` then drops
   `tasks:write` and nothing else, and changing back never adds a scope silently.
   **Recommend: as proposed.**
4. **A disabled agent cannot get a new token** (`409 agent_disabled`), but its existing
   tokens can still be listed and revoked. **Recommend: as proposed.**
5. **Revoking an already revoked token is a `204`**, idempotent like a `DELETE`, with no
   second audit entry. **Recommend: as proposed.**
6. **The token list is not paginated**: at most 10 usable tokens, plus the revoked and
   expired ones, which are kept (WS-071 question 4). If an agent accumulates hundreds over
   the years, a later item can paginate without a breaking change, because the response
   already has the `items`/`nextCursor` shape. **Recommend: as proposed.**

Risks:

- **Two sessions are changing `/me` and `document.ts` at the same time**: WI-076 (item E)
  changes `GET /me`. The overlap is expected in `docs/api/openapi.json` (regenerate after
  merging), `contracts.ts` and the docs tables.
