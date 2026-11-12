# WS-022 — Sign-in hardening: bounded audit and limiter growth

- Status: Approved (by the owner on 2026-11-12)
- Work-item: [WI-022](../work-items/WI-022-sign-in-hardening.md)
- Canonical docs: [0001](../canonical/0001-ai-qa-agents-and-triage.md) section 4,
  [0004](../canonical/0004-api-conventions.md) section 4; WT-02 design decision 10

## Approach

All changes are in the sign-in service and the limiter it already uses. No endpoint, schema
or response changes.

1. **Audit a refusal once per window.** `consumeRateLimit` already returns the counter.
   It will also return `firstRefusal`: true only for the attempt that takes the counter
   from `max` to `max + 1`. `signIn` writes the `rate_limited` audit row only then.
   One row per key and window is enough to show that a key is being hammered, and its
   `retryAfterSeconds` shows until when.

2. **A budget for failure rows.** Before writing any `auth.sign_in_failed` row, `signIn`
   consumes one unit of a limiter key `signin:failure-audit` with the rule
   `{ max: 200, windowSeconds: 900 }`:
   - within the budget: the row is written as today;
   - on the unit that reaches `max`: the row is written with `data.moreSuppressed: true`;
   - beyond it: nothing is written.

   This reuses the existing table and the existing single-statement counter, so it is
   correct under concurrency for the same reason the limiter is. The worst case becomes
   200 rows per 15 minutes (19,200 a day) however many requests arrive, instead of one row
   per request.

   The budget is consulted only after the response has been decided, and the same code
   path runs whether or not the row is written, so it cannot be used to tell a known email
   from an unknown one.

3. **Purge ended windows.** `purgeExpiredRateLimits` deletes rows whose window ended, by
   taking the longest window among the rules (15 minutes) instead of a fixed day. A counter
   has no meaning after its window, so nothing is lost.

4. **Startup warning.** `src/instrumentation.ts` logs one `console.warn` line when
   `NODE_ENV` is `production` and `CLIENT_IP_HEADER` is unset, saying that sign-in
   attempts are limited per email only and naming the variable. The decision is a small
   pure function next to the env schema so it can be unit-tested.

### Not done, and why

- **Not auditing unknown emails at all.** It would remove most of the noise, but it makes
  the request for an unknown email do one database write fewer than for a known one: a
  small timing difference that says whether an email exists. The shared budget has no such
  difference.
- **A cap on all attempts.** See question 1.

## Files

| Path                                                 | Change                                              |
| ---------------------------------------------------- | --------------------------------------------------- |
| `src/server/services/rate-limit.ts`                  | modify: `firstRefusal`, audit rule, purge by window |
| `src/server/services/rate-limit.integration.test.ts` | modify (new cases written first)                    |
| `src/server/services/sign-in.ts`                     | modify: audit once per window, audit budget         |
| `src/server/services/sign-in.integration.test.ts`    | modify (new cases written first)                    |
| `src/server/env.ts`                                  | modify: `productionWarnings(env)`                   |
| `src/server/env.test.ts`                             | modify (new cases written first)                    |
| `src/instrumentation.ts`                             | modify: print the warnings                          |
| `docs/work-specs/WS-015-*.md`                        | no change: it is the record of what was approved    |
| `CONTRIBUTING.md` or `.env.example`                  | modify: one line on the warning                     |

No new dependencies.

## Data model changes

None. `rate_limits` gains one more key (`signin:failure-audit`); its columns are unchanged.

## API contract

None. `POST /api/v1/auth/sign-in` and `POST /api/v1/setup` answer exactly as before.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                           | Covers criterion   |
| --- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 1   | integration | `consumeRateLimit`: `firstRefusal` is true exactly once per window (attempt `max + 1`), false before and after, and true again in a new window | once per window    |
| 2   | integration | 30 concurrent calls with `max` 10: exactly one result has `firstRefusal`                                                                       | once per window    |
| 3   | integration | sign-in: attempts 11 to 20 for one email are all `429`, and exactly one `rate_limited` audit row exists                                        | once per window    |
| 4   | integration | sign-in: with the audit rule lowered to 5 for the test, 12 failures for 12 different emails write 5 rows; the 5th has `moreSuppressed: true`   | budget             |
| 5   | integration | the 6th and the 12th of those failures return the same status, body shape and headers as the 1st                                               | response unchanged |
| 6   | integration | with the budget used up, a successful sign-in still writes `auth.sign_in`, and a sign-out still writes `auth.sign_out`                         | never suppressed   |
| 7   | integration | purge deletes a counter whose window ended 1 second ago and keeps one inside its window                                                        | purge              |
| 8   | unit        | `productionWarnings`: one warning for production without `CLIENT_IP_HEADER`; none with it; none in development or test                         | startup warning    |
| 9   | integration | existing sign-in and limiter tests pass; the one that asserts "the 11th attempt is audited" is kept and still holds                            | nothing regressed  |
| 10  | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`                                                                                        | gate               |

The audit rule is passed to `signIn` as an optional argument with the production default,
the same way `checkHealth` takes its timeout, so test 4 does not need 200 requests.

## Resolved questions

The owner approved this spec as proposed on 2026-11-12:

1. **No cap on all sign-in attempts.** It would let anyone lock every user out. The
   supported protection is a reverse proxy and `CLIENT_IP_HEADER`, which this item warns
   about at startup.
2. **Budget:** 200 audited sign-in failures per 15 minutes.
3. **Suppressed failures are not counted.** The row marked `moreSuppressed` records that
   suppression happened, not how often.
