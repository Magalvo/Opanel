# WI-072 — API tokens: issuing, verifying, and `authenticate()` accepting them

- Status: Proposed
- Work-track: [WT-05](../work-tracks/WT-05-agent-accounts-and-tokens.md) (item B)
- Depends on: WI-071 (done)
- Work-spec: [WS-072](../work-specs/WS-072-api-tokens.md)

## Outcome

A request with `Authorization: Bearer opk_<publicId>_<secret>` is authenticated as the
agent the token belongs to, with exactly that agent's scopes and project restriction. It
reaches every `/api/v1` operation those scopes allow, the events stream included, and
nothing else. A malformed, unknown, expired or revoked token, or one of a disabled agent,
gets the same `401`. Above 600 requests a minute a token gets `429`. Using a token updates
its `last_used_at` and the agent's `last_seen_at`, at most once a minute.

Creating tokens through the API is item C. This item provides the generator, and tests
store tokens directly.

## Acceptance criteria

- [ ] `generateApiToken()` returns a token of the format of WT-05 decision 3, its public
      id, and the SHA-256 of its secret. The secret has 256 bits of randomness and is
      never stored.
- [ ] A valid token authenticates as its agent: `GET` on a project the agent may read
      answers `200`, and an operation needing a scope it lacks answers `403`.
- [ ] Every rejection answers the same `401`, with no database access for a malformed
      header: a malformed header, an unknown public id, a wrong secret, an expired token,
      a revoked token, and a disabled agent.
- [ ] A request with both a token and a session cookie is judged by the token alone.
- [ ] State-changing requests with a token need no `Origin` header.
- [ ] The operations on the caller's own session or password (`PATCH /me`,
      `POST /me/password`, `POST /auth/sign-out`) answer `403` to a token; `GET /me`
      accepts one.
- [ ] `last_used_at` and `last_seen_at` are written at most once a minute per token; a
      failure to write them does not fail the request.
- [ ] Above 600 requests a minute per token: `429 rate_limited` with `Retry-After`. The
      events stream counts once, not per heartbeat.
- [ ] An agent's events stream closes at the next heartbeat after its token is revoked
      or the agent is disabled.
- [ ] The token never appears in a log or a response. The full quality gate passes.
