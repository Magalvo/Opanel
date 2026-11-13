# WS-019 — Accepting an invitation or reset link: set a password (API and page)

- Status: Approved (by the owner on 2026-11-13, all open questions accepted as proposed)
- Work-item: [WI-019](../work-items/WI-019-accept-invitation-or-reset-link.md)
- Canonical docs: [0004](../canonical/0004-api-conventions.md) sections 3, 4, 7;
  [WT-02](../work-tracks/WT-02-accounts-and-permissions.md) decisions 5, 6, 7, 8;
  [WS-018](WS-018-account-management-api.md), [WS-016](WS-016-first-run-setup.md),
  [WS-022](WS-022-sign-in-hardening.md), [WS-023](WS-023-api-guard-rails.md);
  `AGENTS.md` hard rules 4 to 9

## Approach

### 1. Endpoint

`POST /api/v1/account-links/accept`, **public** by declaration of this spec: the person has
no session, and the token is the credential. It exposes nothing: every refusal is the same
`404`. The handler applies `assertSameOrigin` first (WS-023 requires it for every state
change), then reads the body.

| Body (strict)         | Success                                          | Errors                            |
| --------------------- | ------------------------------------------------ | --------------------------------- |
| `{ token, password }` | `200` account summary + `Set-Cookie` (signed in) | `400`, `403`, `404`, `415`, `429` |

`token` is a base64url string of 43 to 128 characters (the tokens of WS-018 are 43);
`password` is `passwordSchema` (12 to 128, no composition rules). The new problem code
`invalid_link` is added for `404` (doc 0004 section 4 allows a specific code for a status).
The token travels in the body, not in the URL, so it is in no access log.

### 2. Service (`src/server/services/accept-link.ts`)

`acceptLink({ token, password, clientIp, headers }, db = getDb())`:

1. If a client address is known, consume `accept:ip:<address>` (30 attempts per 15 minutes;
   `ACCEPT_LINK_IP_RULE` in `rate-limit.ts`, which `LONGEST_WINDOW_SECONDS` already covers).
   Over the limit: `rateLimited`, with no audit row. With no configured address nothing is
   limited here: the token is 256 random bits, so guessing is not the risk, and a global
   limit would let anyone lock out every real link. This mirrors WS-015 and WS-022.
2. Hash the password (`hashPassword`) **before** the transaction, as setup does.
3. In one transaction: find the token row by `SHA-256(token)` **`FOR UPDATE`** joined to its
   account. It is valid only if unused, not expired, and its account is a human account that
   is not deactivated; otherwise throw `invalid_link()`. The row lock is what makes a link
   single-use under concurrency: a second request waits, then sees it used.
   Then: set `used_at`; upsert the account's `credential` row (`provider_id` `credential`,
   `provider_account_id` the account id) with the new hash; delete **all** the account's
   `sessions`; delete its other unused links; write the audit entry with the account as
   actor (`account.invitation_accepted` for kind `invitation`, `account.password_changed`
   with `data: { via: "reset_link" }` for `reset`).
4. After the commit, `signIn` (WS-015) with the account's email and the new password creates
   the session and writes `auth.sign_in`. As in WS-016, this is the one step Better Auth
   keeps outside Opanel's transaction: if it fails the password is already set and the
   person can sign in normally.
5. Return `{ account, headers }`; the route sends `200` with the cookie.

An invalid attempt writes nothing to the audit log (WS-022: an anonymous caller must not be
able to grow an append-only table).

### 3. Page (`/accept`)

- `src/app/accept/page.tsx` is a static server component (no database) that renders
  `AcceptForm`, and sets `referrer: "no-referrer"` in its metadata. `/accept` is added to
  the proxy's public paths (`src/proxy.ts`).
- `AcceptForm` (`src/components/accept-form.tsx`, client): on mount it reads the token from
  `window.location.hash` and immediately removes it from the address bar with
  `history.replaceState`, so it is not in the history or on a screenshot of the address. A
  missing token shows "This link is not valid." and no form. Otherwise it shows a password
  and a confirmation (native labels, the existing `Input` and `Button`); a mismatch is
  reported in the browser and nothing is sent. Submit `POST`s `{ token, password }`. `200`:
  `window.location.assign("/")` (a full load, as the sign-in form does, because the server
  must render with the new cookie). `404`: "This link is no longer valid. Ask an
  administrator for a new one." `400`: the field errors. `429`: the wait. Anything else: a
  generic message. The button is disabled while the request is in flight.

### 4. Existing code touched

`src/proxy.ts` (public path), `src/lib/schemas/problem.ts` and `src/server/http/errors.ts`
(`invalid_link`), `src/server/services/rate-limit.ts` (one rule), `src/lib/schemas/auth.ts`
(request schema and contract, next to the other public auth operations) and
`src/lib/openapi/contracts.ts`. The WS-023 test that checks route files will cover the new
route without change: it is state-changing, so it must call `assertSameOrigin(`, and it is
public, so it needs neither `authenticate(` nor `requirePermission(`.

## Files

| Path                                                                         | Change                         |
| ---------------------------------------------------------------------------- | ------------------------------ |
| `src/server/services/accept-link.ts`, `accept-link.integration.test.ts`      | create (tests first)           |
| `src/app/api/v1/account-links/accept/route.ts`, `route.integration.test.ts`  | create (tests first)           |
| `src/lib/schemas/auth.ts`, `auth.test.ts`                                    | modify: schema and contract    |
| `src/lib/schemas/problem.ts`, `problem.test.ts`, `src/server/http/errors.ts` | modify: `invalid_link`         |
| `src/server/services/rate-limit.ts`, `rate-limit.integration.test.ts`        | modify: `ACCEPT_LINK_IP_RULE`  |
| `src/lib/openapi/contracts.ts`, `docs/api/openapi.json`                      | modify / regenerate            |
| `src/proxy.ts`, `src/proxy.test.ts`                                          | modify: `/accept` is public    |
| `src/app/accept/page.tsx`, `page.test.tsx`                                   | create (tests first)           |
| `src/components/accept-form.tsx`, `accept-form.test.tsx`                     | create (tests first)           |
| `tests/e2e/accept-link.spec.ts`                                              | create                         |
| `docs/canonical/0004`, `docs/README.md`, WT-02, WI-019, WS-019               | modify: statuses, the new code |

No new dependencies and no migration: `account_tokens.used_at` and the unique
`(provider_id, provider_account_id)` of `credentials` already exist.

## Data model changes

None.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                                                                                             | Criterion       |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- |
| 1   | unit        | request schema: strict; token 43 to 128 base64url characters; password 12 to 128; a short password, a bad token, a missing field and unknown fields fail                                                                                         | input rules     |
| 2   | unit        | `invalid_link` is a problem code; the contract is public and documents `404` and `429`; the contracts-versus-routes and guard-rail tests pass for the new route                                                                                  | OpenAPI         |
| 3   | unit        | proxy: `/accept` is never redirected, with or without a cookie                                                                                                                                                                                   | page            |
| 4   | unit        | `AcceptForm`: reads the token from the hash and removes it from the address bar; no token shows the invalid message and no form                                                                                                                  | page            |
| 5   | unit        | `AcceptForm`: a mismatching confirmation sends nothing; a valid submit posts `{ token, password }` only; `200` loads `/`; `404`, `400` and `429` show their messages; the button is disabled while sending                                       | page            |
| 6   | integration | `ACCEPT_LINK_IP_RULE`: the 31st attempt from one address is refused with a retry delay; its counters are purged with the others                                                                                                                  | limiter         |
| 7   | integration | invitation: sets an Argon2id credential for an invited account, marks the link used, returns a cookie that authenticates `GET /me`, and the new password signs in                                                                                | invitation      |
| 8   | integration | reset: replaces the password (the old one fails, the new one works) and ends every earlier session of the account, including those on other devices                                                                                              | reset, sessions |
| 9   | integration | audit: `account.invitation_accepted` or `account.password_changed` (`via: reset_link`) with the account as actor, then `auth.sign_in`; the token and password are in no row                                                                      | audit           |
| 10  | integration | unknown token, used link, expired link, deactivated account and a link replaced by a newer one all throw the same `404 invalid_link`, and write no audit row                                                                                     | single use      |
| 11  | integration | 5 concurrent requests with the same link: exactly one succeeds, the rest are `404`; the account ends with one credential                                                                                                                         | race            |
| 12  | integration | a trigger that fails the audit insert leaves the link unused, no credential and the old sessions intact                                                                                                                                          | atomic          |
| 13  | integration | 20 invalid attempts write no audit row and no more than the limiter counters                                                                                                                                                                     | no log growth   |
| 14  | integration | route: `200` with the account and a hardened cookie; `404` bodies for the refusal cases are identical apart from the request id; `400` per field without echoing the password; `403` for a foreign `Origin` before the body is read; `415`       | route           |
| 15  | integration | the whole journey: an Admin invites through the service, the token from the link is accepted through the route, and `/me` with the cookie shows the invited person                                                                               | journey         |
| 16  | integration | no response, log line or audit entry contains the password, its hash, the link token or the session token                                                                                                                                        | secrets         |
| 17  | integration | `/accept` page renders without a database and sets `referrer: no-referrer`                                                                                                                                                                       | page            |
| 18  | e2e         | in a browser: Admin invites; a fresh browser opens the link, the fragment disappears from the address, a password is set, the app loads; the same link is then refused; a reset link then sets a new password and the old one no longer signs in | end to end      |
| 19  | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; `pnpm db:generate` and `pnpm openapi:generate` leave no diff                                                                                                                            | gate            |

## Risks and open questions

For the owner:

1. **Signed in straight after choosing a password.** Like the first-run setup, the response
   sets a session cookie, so the person lands in the app (and the audit log gets
   `auth.sign_in` as well). The alternative is to send them to the sign-in page to type the
   password again. I recommend signing them in. Agree?
2. **No preview of the link.** The page cannot greet the person by name or say "expired"
   before they type a password, because that would need a second public endpoint that
   answers questions about a token. Every refusal (unknown, used, expired, replaced,
   deactivated) is one identical message. The alternative is a preview endpoint, which
   gives a nicer page and a small oracle. I recommend no preview. Agree?
3. **Failed attempts are not audited, and are limited only per address.** Only successes
   reach the audit log (an anonymous caller must not be able to grow it, WS-022), and the
   limiter needs `CLIENT_IP_HEADER`, because the token itself cannot be guessed. Agree?

Technical, settled by the tests:

4. **Row lock for single use.** `SELECT ... FOR UPDATE` on the token row inside the
   transaction is what makes two simultaneous requests unable to both succeed (test 11). If
   Drizzle 0.45's `for("update")` does not behave as its documentation says, I stop and
   report.
5. **Reading `location.hash` in a client component.** It is only available after mount, so
   the form renders nothing until then; the test and the browser test cover the sequence.
6. **Session cookie after a password change.** Accepting a link ends all of the account's
   sessions, including one the person may have in another browser, before the new one is
   created (decision 7). That is intended and is stated on the page: "You will be signed out
   everywhere else."
