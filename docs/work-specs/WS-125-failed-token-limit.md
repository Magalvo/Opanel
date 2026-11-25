# WS-125 — Failed API token attempts are limited per address

- Status: Proposed
- Work-item: [WI-125](../work-items/WI-125-failed-token-limit.md)
- Canonical docs: [0001](../canonical/0001-ai-qa-agents-and-triage.md) (agent tokens),
  [0004](../canonical/0004-api-conventions.md) (errors), [0006](../canonical/0006-operations.md)
  (reverse proxy); WS-072 (API tokens, its question 3), WS-015 and WS-022 (the sign-in
  limiter and its bounded growth)

## Approach

### 1. Where the limit sits

In `route()` (`src/server/http/route.ts`), around its call to `authenticate()`, and only
when the request carries an `Authorization` header (the token path, canonical doc 0004
section 7). `authenticate()` itself does not change, so two callers stay out of the count
by construction:

- session (cookie) requests, which never reach the token path;
- the event stream's heartbeat checks (`event-stream.ts`, WS-124), which call
  `authenticate()` directly: their pace is the server's, not the client's, and a refusal
  there would close a valid stream because of someone else's failures.

The order in `route()` becomes: same-origin check (unchanged), then for a token request
the address check below, then `authenticate()`, then the per-token limit (unchanged), the
`session` refusal, the permission and the query check.

### 2. The limiter: `src/server/auth/failed-token-limit.ts`

In the app's memory, like the per-token limiter (WT-05 decision 8, WS-072 section 6): one
app process (doc 0006 section 3), no database write per request, and a restart only ever
lets a client through sooner. A fixed window per key.

```ts
createFailedTokenLimiter({ limit = 30, windowMs = 60_000, maxKeys = 10_000, now = Date.now })
  .begin(key): { allowed: true } | { allowed: false; retryAfterSeconds: number; firstRefusal: boolean }
  .succeeded(key): void   // gives back the unit begin() took
  .sweep(): void          // drops ended windows; the shared instance runs it every minute
  .size(): number         // for tests
```

- `begin` counts the attempt **before** the lookup and refuses once the window already
  holds `limit` attempts; `succeeded` gives the unit back when the token authenticated. So
  only failures stay counted, and a burst of concurrent wrong tokens cannot all pass a
  check that their own failures have not reached yet: at most `limit` lookups per key and
  window, whatever the concurrency. (A request whose token is valid holds a unit only
  while it is being checked.)
- A refusal makes no database query: the `429` is thrown before `authenticate()`.
- Any `ApiError` with status `401` from `authenticate()` leaves the unit counted. Any other
  outcome (success, `403` of a `session` operation, a `500` from the database) calls
  `succeeded`: only a credential that did not authenticate counts.
- `retryAfterSeconds` is the window's remaining time, at least 1, as the per-token limiter
  computes it; `route()` throws the existing `rateLimited(retryAfterSeconds)`, so the body
  and `Retry-After` are those of every other `429 rate_limited`.
- **Bounded memory.** At most `maxKeys` keys have a window. When the map is full, an
  address without a window is counted under the one shared key `overflow` instead of a key
  of its own, until a sweep frees room. Ten thousand entries are well under a megabyte;
  the cost of the bound is that, under a flood from more than 10 000 addresses, the
  addresses beyond it share one budget.
- The shared instance lives on `globalThis` and is swept every minute, as
  `getTokenRateLimiter()` is; `RouteOptions` gains `failedTokenLimiter` to inject one in
  tests.

### 3. The key: the trusted client address

`failedTokenKey(request, clientIpHeader)` in the same file, using the existing
`clientIpFrom(request, getEnv().CLIENT_IP_HEADER)` (sign-in and link acceptance use it):

| Situation                                                  | Key                                                        |
| ---------------------------------------------------------- | ---------------------------------------------------------- |
| `CLIENT_IP_HEADER` not set                                 | none: no limit, as today (section 4)                       |
| IPv4 address                                               | `ip:203.0.113.9`                                           |
| IPv4-mapped IPv6 (`::ffff:203.0.113.9`)                    | the IPv4 key                                               |
| other IPv6 address                                         | its `/64`, written in full: `ip6:2001:0db8:0001:0002::/64` |
| header configured but missing, or its last entry not an IP | `unknown`: one shared key                                  |

- Only the last entry of the configured header is read (`clientIpFrom`); any other header
  (`X-Real-IP`, `Forwarded`, an `X-Forwarded-For` when another header is configured) is
  ignored. Behind the example proxy, which overwrites the header, the client chooses none
  of it.
- An IPv6 client usually holds a whole `/64` and can change its address within it at will;
  counting the `/64` keeps it to one budget.
- `unknown` cannot occur behind a proxy that writes the header; if the proxy is
  misconfigured, the shared key still bounds the lookups instead of letting a client
  escape by sending no address.
- The key holds an address and never any part of the `Authorization` header. `RouteOptions`
  gains `clientIpHeader` (default: `getEnv().CLIENT_IP_HEADER`, read per request) for tests.

### 4. Without a trusted client address

No pre-authentication limit, as today. One install-wide budget was considered and refused:
a single client could then lock every agent out (the reasoning of WS-019 for link
acceptance). Instead the production start-up warning (`productionWarnings` in
`src/server/env.ts`) adds that failed API token attempts are then not limited per address,
and `docs/operations.md` says the same where it explains `CLIENT_IP_HEADER`.

### 5. The first refusal is logged

When `begin` refuses a key for the first time in its window (`firstRefusal`, as WS-022's
limiter reports it), `route()` writes one line through its `logError`:
`Failed API token attempts from 203.0.113.9 reached 30 a minute; refusing them for 42 s.`
(for `overflow` and `unknown`, those words instead of an address). One line per key and
window, never the token. No audit row: the audit log records what accounts did, and these
requests have no account.

### 6. Documentation

- `docs/operations.md`: the "Reverse proxy and HTTPS" requirement 1 and the rate-limit
  paragraph under monitoring say that with `CLIENT_IP_HEADER` set an address may fail token
  authentication 30 times a minute, then gets `429` with `Retry-After`; without it there is
  no such limit. The example Caddyfile stays as it is (question 2).
- Canonical doc 0001 ("Token-authenticated requests are rate limited per token"): adds the
  per-address limit on failed attempts.
- `docs/agents.md`, the `429 rate_limited` row: also returned after repeated failed tokens
  from one address.
- WS-072 is `Done` and stays as written; its question 3 is answered by this spec, which the
  index's B07 entry records after the merge.

## Files

| Path                                                       | Change                                                |
| ---------------------------------------------------------- | ----------------------------------------------------- |
| `src/server/auth/failed-token-limit.ts` (+ unit test)      | create: sections 2 and 3                              |
| `src/server/http/route.ts`                                 | modify: section 1, the first-refusal line (section 5) |
| `src/server/http/route-failed-token.integration.test.ts`   | create: tests 4 to 10                                 |
| `src/server/env.ts` (+ `env.test.ts`)                      | modify: the start-up warning (section 4)              |
| `docs/operations.md`, `docs/agents.md`, canonical doc 0001 | modify: section 6                                     |

## Data model changes

None. The counts live in the app process.

## API contract

No new status code or schema: every operation a token may call already documents
`429 rate_limited` (WS-083), and its body and `Retry-After` are unchanged. A token request
may now receive it before authentication. The OpenAPI document does not change unless the
shared `429` description is reworded to mention failed attempts (then `pnpm
openapi:generate`).

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                                                                                                      | Covers criterion          |
| --- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| 1   | unit        | limiter with an injected clock and `limit` 3: three `begin`s allowed, the fourth refused with `retryAfterSeconds` up to the window's end and `firstRefusal` true, the fifth with `firstRefusal` false; the next window allows; keys are independent       | flood bounded, stable 429 |
| 2   | unit        | `succeeded` gives the unit back: any number of `begin` + `succeeded` pairs never refuses; three `begin`s without it, interleaved with successes, refuse the next                                                                                          | valid tokens unaffected   |
| 3   | unit        | bounded memory: with `maxKeys` 2, a third address is counted under `overflow`; `sweep` drops ended windows and frees room; `size` never passes `maxKeys` + 1                                                                                              | memory bounded            |
| 4   | unit        | `failedTokenKey`: no header configured → none, whatever `X-Forwarded-For` holds; IPv4; IPv4-mapped → IPv4; two IPv6 addresses of one `/64` → one key, of two `/64`s → two; configured header missing or not an IP → `unknown`; only the last entry counts | spoofing, no trusted IP   |
| 5   | integration | through `route()` with `CLIENT_IP_HEADER=x-forwarded-for` and `limit` 3, against the real database: three well-formed wrong tokens are `401`; the 4th to 20th are all `429 rate_limited` with `Retry-After` between 1 and 60                              | flood bounded, stable 429 |
| 6   | integration | a refused address gets `429` even with a valid token (the refusal precedes the lookup); after the window (injected clock) the valid token is `200` again                                                                                                  | no query when refused     |
| 7   | integration | spoofing: requests whose `X-Forwarded-For` is `<random>, 203.0.113.9` all count against `203.0.113.9`; a varying `X-Real-IP` changes nothing; a valid token from `198.51.100.7` is `200` while `203.0.113.9` is refused                                   | spoofing, other addresses |
| 8   | integration | valid tokens never count: 50 requests with a valid token, then two wrong ones are `401`, not `429`; session requests and `authenticate()` called directly (the heartbeat's path) leave the limiter empty                                                  | valid tokens, scope       |
| 9   | integration | the `401` bodies of a malformed header, an unknown public id, a wrong secret, a revoked token, an expired token and a disabled agent are identical but for `requestId`; the address check's `429` body equals the per-token limit's                       | indistinguishable bodies  |
| 10  | integration | without `CLIENT_IP_HEADER`, 50 wrong tokens are all `401` and the limiter stays empty; the first refusal writes exactly one `logError` line naming the address, and no line or limiter key contains any part of the token                                 | no trusted IP, no secrets |
| 11  | unit        | `productionWarnings` without `CLIENT_IP_HEADER` names failed API token attempts as not limited per address                                                                                                                                                | no trusted IP             |
| 12  | integration | existing tests pass: the per-token `429` (WS-072 test 10), the access order of `route-access.integration.test.ts`, sign-in's limiter                                                                                                                      | nothing regressed         |

## Risks and open questions

1. **App limiter, proxy limit, or both?** Recommendation: **the app limiter alone**
   (sections 1 to 5). Caddy's standard build has no rate limiter; the example would need a
   third-party module (`caddy-ratelimit`) and a custom image, which the production files
   pin by digest and CI rehearses, so that is a separate decision with its own upkeep. The
   nginx example could gain a `limit_req` zone, but it is not rehearsed by CI and would
   limit every request, not only failed ones. `docs/operations.md` would mention a proxy
   limit as optional defence in depth, without configuration.
2. **The numbers.** Recommendation: **30 failed attempts per address per minute**, at most
   10 000 tracked addresses. An agent with a mistyped or revoked token fails a few times a
   minute at most; 30 a minute caps a flood at one lookup every two seconds per address.
   The per-token limit stays 600 a minute.
3. **Without `CLIENT_IP_HEADER`.** Recommendation: **no limit, plus the warning**
   (section 4), as link acceptance does. The alternative, one install-wide budget, bounds
   the database work but lets anyone lock out every agent.
4. **A shared address.** Agents behind one NAT with an attacker, or a misconfigured agent
   on the same host as healthy ones, are refused together while the address is over its
   budget. Accepted as the cost of refusing before the lookup; a refusal lasts at most a
   minute.
5. **The first-refusal log line** (section 5) is recommended, so an operator can see a
   flood and its source. It records the client address in the app log. If the owner
   prefers no address in logs, the line says only "an address".
6. **Cookie requests are not covered.** A request with a wrong session cookie also costs a
   session lookup; B07 is about tokens, and sign-in already limits the password path.
   Recorded as a follow-up if the owner wants it.
