# WI-075 — The Admin API for agents and their tokens

- Status: Proposed
- Work-track: [WT-05](../work-tracks/WT-05-agent-accounts-and-tokens.md) (item C)
- Depends on: WI-072 (done)
- Work-spec: [WS-075](../work-specs/WS-075-agents-admin-api.md)

## Outcome

An Admin manages agents and their tokens through `/api/v1`, the same API the Agents page
(item F) will use:

- create an agent with a role, scopes and projects;
- list agents and read one;
- change an agent's name, description, role, scopes or projects;
- disable an agent and re-enable it;
- create a token, which is shown once;
- list an agent's tokens and revoke one.

Every change is audited with the acting Admin, and never with a token. The OpenAPI
document declares the bearer scheme, so agent authors see that tokens are accepted.

## Acceptance criteria

- [ ] Only `agents:manage` (Admins) reaches these endpoints. A Manager, and any agent
      token, gets `403`.
- [ ] Creating an agent validates its name, role, scopes and projects. A name another
      agent has in any letter case gets `409 agent_name_taken`. Scopes default to the
      role's; scopes outside the role, or unknown projects, answer `400` with the field
      named.
- [ ] Editing an agent applies the same rules. Disabling stops its tokens at once,
      re-enabling restores them, and nothing is deleted.
- [ ] Creating a token returns `opk_…` exactly once with its metadata. Its expiry is 30,
      90 or 365 days or none, 90 by default. At most 10 usable tokens per agent
      (`409 too_many_tokens`), checked under a lock. A disabled agent gets no new token
      (`409 agent_disabled`).
- [ ] The token list shows every token's name, dates and status (`active`, `expired`,
      `revoked`), never its secret or hash. Revoking stops the token at once; revoking it
      again is a no-op.
- [ ] Each write records one audit entry with the acting Admin: `agent.created`,
      `agent.updated` (the changed fields), `agent.disabled`, `agent.reenabled`,
      `agent.token_created`, `agent.token_revoked`. None holds the token or its hash.
- [ ] The OpenAPI document declares `bearerAuth` on every operation that accepts a token,
      and the cookie only on the `session` operations.
- [ ] The Zod schemas generate the OpenAPI document. The full quality gate passes.
