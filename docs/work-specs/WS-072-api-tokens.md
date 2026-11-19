# WS-072 — API tokens: issuing, verifying, and `authenticate()` accepting them

- Status: Approved (by the owner on 2026-11-19, questions 1 to 4 as proposed)
- Work-item: [WI-072](../work-items/WI-072-api-tokens.md)
- Canonical docs: [0001](../canonical/0001-ai-qa-agents-and-triage.md) (section 4: agent
  tokens); [0004](../canonical/0004-api-conventions.md) (section 4: `401` says nothing;
  section 7: a bearer token excludes the cookie, the same-origin check);
  [WT-05](../work-tracks/WT-05-agent-accounts-and-tokens.md) (decisions 3, 5, 6, 8, 9);
  [WS-071](WS-071-agent-data-model.md) (`api_tokens`, `loadAgentActor`);
  [WS-047](WS-047-events-endpoint.md) (the heartbeat re-authenticates); AGENTS.md hard
  rule 7

## Approach

### 1. Where things stand (checked on 2026-11-19, `main` at `adea79f`)

- `authenticate(request)` (`src/server/auth/authenticate.ts`) throws `401` for any request
  with an `Authorization` header, and otherwise reads the Better Auth session. It returns
  `{ actor, account, sessionId, headers }`.
- `route()` (`src/server/http/route.ts`) runs the same-origin check first, which already
  skips requests with `Authorization` (`origin.ts`), then `authenticate()`, then the
  permission. `AuthFor<Contract>` is `Authenticated` for every non-public access.
- Four operations are `access: { kind: "authenticated" }`: `GET /me`, `PATCH /me`,
  `POST /me/password` and `POST /auth/sign-out`. The last two read `sessionId`. The
  approved list is checked by `src/server/http/route-access.integration.test.ts` and
  `src/lib/openapi/routes.test.ts`.
- The events stream re-runs `authenticate(request)` on every heartbeat (25 s) and closes
  when it throws or `tasks:read` is gone.
- `api_tokens`, `loadAgentActor` and `createTestAgent` exist (WI-071). Nothing issues or
  reads a token yet.
- `rateLimited(seconds)` already builds the `429 rate_limited` problem with
  `Retry-After` (`errors.ts`).

### 2. Tokens: `src/server/auth/api-token.ts`

Pure functions, Node's `crypto` only:

- `generateApiToken(): { token, publicId, secretHash }`. `publicId` is 12 characters from
  the alphabet `a-z2-7`, from `randomBytes(12)`, each byte `& 31` (no modulo bias). The
  secret is `randomBytes(32)` as 64 hex characters. `token = "opk_" + publicId + "_" +
secret`, and `secretHash = sha256hex(secret)`.
- `parseBearer(header: string | null): { publicId, secret } | null` accepts exactly
  `Bearer opk_<[a-z2-7]{12}>_<[0-9a-f]{64}>`. The scheme name is case-insensitive
  (RFC 9110) and there is one space. Anything else gives `null`.
- `secretMatches(secret, storedHash): boolean` compares
  `timingSafeEqual(sha256(secret), Buffer.from(storedHash, "hex"))`. Both sides are
  32 bytes.

### 3. `authenticate()` with a token

`Authenticated` becomes a union, distinguished by `via`:

```ts
interface SessionAuthenticated {
  via: "session";
  actor: HumanActor;
  account;
  sessionId: string;
  headers;
}
interface TokenAuthenticated {
  via: "token";
  actor: AgentActor;
  account;
  tokenId: string;
  headers: Headers; /* empty */
}
export type Authenticated = SessionAuthenticated | TokenAuthenticated;
```

When `Authorization` is present, the cookie is never read, and the checks run in this
order:

1. `parseBearer` fails: `401`, with no database access.
2. Select the `api_tokens` row by `public_id`. Not found: `401`.
3. `secretMatches` is false: `401`.
4. `revoked_at` is set, or `expires_at <= now()`: `401`.
5. `loadAgentActor(db, row.account_id)`. If it is `null` or `disabledAt` is set: `401`.
6. Record the use (section 5), and return
   `{ via: "token", actor, account, tokenId: row.id, headers: new Headers() }`.

Every failure is `unauthenticated()` with its default detail. Neither the token nor the
reason is logged.

### 4. Session-only operations

`Access` gains a fourth kind, `{ kind: "session" }`: "the caller's own signed-in session".

- `PATCH /me`, `POST /me/password` and `POST /auth/sign-out` move from `authenticated`
  to `session`. `GET /me` stays `authenticated` and accepts both.
- `route()`: for `session` access, a `TokenAuthenticated` caller gets `403 forbidden`.
  `AuthFor` gives `SessionAuthenticated` for `session` access, so the two handlers that
  read `sessionId` keep a `string` and type-check unchanged.
- The approved list of authentication-only operations (doc 0004 section 7) is unchanged.
  It is now split into "authenticated: `GET /me`" and "session: the other three". The
  WS-023/WS-025 tests are updated to the split, and doc 0004 section 7 gets one sentence
  (open question 1).
- In the OpenAPI document, `x-opanel-permission` is absent for both access kinds, as
  today. The `session` operations get the description line "Not available to API
  tokens." No schema changes.

WT-05 item E then only shapes `GET /me`'s body for agents (decision 9).

### 5. `last_used_at` and `last_seen_at`

`recordTokenUse(db, tokenId, accountId)` runs two statements outside any request
transaction:

```sql
update api_tokens set last_used_at = now()
  where id = $1 and (last_used_at is null or last_used_at < now() - interval '1 minute');
update accounts set last_seen_at = now()
  where id = $2 and (last_seen_at is null or last_seen_at < now() - interval '1 minute');
```

`authenticate()` awaits them, but a failure is logged with `describeError` and the request
goes on (open question 2). The runtime role has `UPDATE` on both tables.

### 6. Rate limit: `src/server/auth/token-rate-limit.ts`

`createTokenRateLimiter({ limit = 600, windowMs = 60_000, now = Date.now })` returns
`hit(tokenId): { allowed: true } | { allowed: false; retryAfterSeconds }`.

- It keeps a fixed window per token in a `Map`.
- An entry whose window has ended is replaced on its next hit.
- A sweep every `windowMs` drops ended windows, so memory stays bounded by the tokens used
  in the last minute.
- One instance lives on `globalThis`, like the event hub, so hot reload does not reset
  it.

`route()` calls `hit(auth.tokenId)` right after authentication, for `via: "token"` only,
and throws `rateLimited(retryAfterSeconds)` when it is not allowed. The events stream's
heartbeats call `authenticate()` directly, not `route()`, so a stream counts once when it
opens (WT-05 decision 8). Humans are not limited here.

### 7. The events stream

No code change. The route goes through `route()` with `tasks:read`, so a token works. The
heartbeat's `authenticate(request)` re-reads the token row and the agent, so a revocation,
an expiry or a disabled agent closes the stream within 25 seconds. A test proves both.
Project restrictions on the stream are item D.

### 8. Test helpers

`src/server/auth/testing.ts` gains:

- `createTestToken(agentId, { expiresAt?, revokedAt?, name? })`, which stores a row from
  `generateApiToken()` and returns the token;
- `bearerRequest(path, token, init?)`, which builds a request with `Authorization` and no
  `Origin`.

### 9. Operations guide

`docs/operations.md`, "Logs" and "Health and outages": one sentence saying that requests
made with an API token are limited to 600 a minute per token, in the app process
(WT-05 decision 8).

### Considered and not chosen

- **Argon2id for the secret**: the secret has 256 bits of entropy, and SHA-256 is enough
  (doc 0001 section 4). A slow hash would make every agent request cost a hash.
- **Rate limiting in `rate_limits`**: one database write per request (WT-05 decision 8).
- **Refusing agents inside each of the three handlers**: `route()` already decides access,
  and doing it in handlers would leave the `sessionId` type wrong.

## Files

| Path                                                                                 | Change                                                       |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `src/server/auth/api-token.ts` (+ unit test)                                         | create: section 2                                            |
| `src/server/auth/token-rate-limit.ts` (+ unit test)                                  | create: section 6                                            |
| `src/server/auth/authenticate.ts` (+ integration test)                               | modify: section 3, `recordTokenUse`                          |
| `src/lib/openapi/contract.ts`, `src/lib/openapi/document.ts` (+ tests)               | modify: the `session` access kind                            |
| `src/server/http/route.ts` (+ integration test)                                      | modify: the `session` access check, the rate limit           |
| `src/lib/schemas/auth.ts`                                                            | modify: three contracts to `session`                         |
| `src/server/http/route-access.integration.test.ts`, `src/lib/openapi/routes.test.ts` | modify: the split list                                       |
| `src/server/http/event-stream.integration.test.ts`                                   | modify: a token's stream closes on revocation and on disable |
| `src/server/auth/testing.ts`                                                         | modify: section 8                                            |
| `docs/canonical/0004-api-conventions.md`                                             | modify: one sentence in section 7                            |
| `docs/operations.md`                                                                 | modify: section 9                                            |
| `docs/README.md`, WT-05, WI-072, WS-072                                              | modify: statuses                                             |

## Data model changes

None. `api_tokens` exists (WI-071).

## API contract

- Every non-public operation now accepts `Authorization: Bearer <agent token>`, with the
  `401` and `403` rules of doc 0004.
- `PATCH /me`, `POST /me/password` and `POST /auth/sign-out` answer `403` to a token.
  Tokens did not exist before, so this breaks no client.
- `429 rate_limited` can now be returned to any token request.
- No schema changes. The bearer scheme in the OpenAPI document is item C (WT-05 decision
  14).

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                                                                       | Covers criterion |
| --- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit        | `generateApiToken`: format regex; `publicId` alphabet and length; `secretHash` is the SHA-256 of the secret part; 1 000 tokens have distinct public ids and secrets                                                        | 1                |
| 2   | unit        | `parseBearer`: accepts the format and `bearer`/`BEARER`; refuses no header, `Basic …`, two spaces, wrong prefix, uppercase or short public id, 63 hex characters, a trailing character                                     | 3                |
| 3   | unit        | `secretMatches`: true for the secret, false for another one                                                                                                                                                                | 3                |
| 4   | unit        | rate limiter with an injected clock: the 600th hit is allowed and the 601st is not, with `retryAfterSeconds` up to the window's end; the next window allows again; tokens are independent; the sweep empties ended windows | 8                |
| 5   | integration | `authenticate` with a token: `via: "token"`, the agent's actor, `tokenId`; with a cookie as well, the token decides                                                                                                        | 2, 4             |
| 6   | integration | `authenticate` refusals, each `401` with the default detail: malformed (no query made, checked with a spy on `getDb`), unknown public id, wrong secret, expired, revoked, disabled agent                                   | 3                |
| 7   | integration | `recordTokenUse`: the first use writes both columns; a second use within the minute does not; a forced failure is logged and the request still succeeds                                                                    | 7                |
| 8   | integration | through `route()`: `GET /api/v1/projects` with a `projects:read` token is `200`; `POST` a task with a token lacking `tasks:write` is `403`; a token `POST` with no `Origin` passes the origin check                        | 2, 5             |
| 9   | integration | `PATCH /me`, `POST /me/password`, `POST /auth/sign-out` with a token are `403`; `GET /me` with a token is `200`; the same operations with a session work as before                                                         | 6                |
| 10  | integration | the rate limit through `route()` with a limiter of 3: the 4th request is `429` with `Retry-After`                                                                                                                          | 8                |
| 11  | integration | the events stream with a token opens; it closes at the next heartbeat after the token is revoked, and likewise after the agent is disabled (short heartbeat as in WS-047's tests)                                          | 8, 9             |
| 12  | integration | the route-access and OpenAPI tests with the split list                                                                                                                                                                     | 6                |
| 13  | unit        | no log line contains the token: run checks 5 to 11 with a log spy, and search the spy's calls for the secret                                                                                                               | 10               |
| 14  | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`                                                                                                                                                                    | 10               |

## Risks and open questions

For the owner:

1. **A `session` access kind for `PATCH /me`, `POST /me/password` and
   `POST /auth/sign-out`, in this item.** WT-05 gave this to item E. Without it, the
   moment tokens work, an agent could rename itself (`PATCH /me`), and the two handlers
   that need a session would receive a caller without one. So it belongs with the change
   that lets tokens in. Item E keeps `GET /me`'s body for agents. **Recommend: as
   proposed.**
2. **`last_used_at` failures do not fail the request.** The request is already
   authenticated, and refusing it because a bookkeeping update failed would turn a
   database hiccup into agent outages. It is logged. **Recommend: as proposed.**
3. **The rate limit counts after authentication**, so a flood of bad tokens is not
   limited per token. Each one costs, at most, an indexed lookup and a SHA-256. A
   malformed one costs nothing. Limiting unauthenticated traffic is the reverse proxy's
   job (doc 0006). **Recommend: as proposed.**
4. **Accept `bearer` in any case** (the scheme name is case-insensitive in HTTP), rather
   than only `Bearer`. **Recommend: any case.**

Risks:

- **`Authenticated` becomes a union.** Code that reads `sessionId` must narrow on `via`.
  The search in section 1 found two handlers, both of which move to `session` access, so
  `tsc` finds any other.
- **The parallel item D** (WI-073, project restrictions) also touches
  `src/server/http/event-stream.ts` callers and services. This item changes neither the
  services nor `event-stream.ts`, so the expected overlap is `docs/README.md` and the
  WT-05 table only.
