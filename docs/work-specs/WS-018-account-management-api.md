# WS-018 — Account management API: list, invite, change role, deactivate, reactivate

- Status: Approved (by the owner on 2026-11-12, all open questions accepted as proposed)
- Work-item: [WI-018](../work-items/WI-018-account-management-api.md)
- Canonical docs: [0003](../canonical/0003-task-management.md) section 3;
  [0004](../canonical/0004-api-conventions.md) sections 3 to 7;
  [WT-02](../work-tracks/WT-02-accounts-and-permissions.md) decisions 5 to 9;
  `AGENTS.md` hard rules 4 to 9

## Approach

### 1. Endpoints

All five require authentication and `accounts:manage` (`requirePermission`, WS-012), apply
`assertSameOrigin` to the state-changing ones, and are wrapped with `route()`. The
operations are **not** public.

| Operation                                      | Body                                       | Success                       | Errors                     |
| ---------------------------------------------- | ------------------------------------------ | ----------------------------- | -------------------------- |
| `GET /api/v1/accounts?limit&cursor`            | none                                       | `200` `{ items, nextCursor }` | `400`                      |
| `POST /api/v1/accounts`                        | `{ name, email, role }`, strict            | `201` `{ account, link }`     | `400`, `409`, `415`        |
| `PATCH /api/v1/accounts/{accountId}`           | `{ role?, active? }`, strict, one required | `200` the account             | `400`, `404`, `409`, `415` |
| `POST /api/v1/accounts/{accountId}/reset-link` | none                                       | `201` `{ link }`              | `404`, `409`               |

`401` and `403` are documented automatically (doc 0004 section 7).

- **Account (list item):** `{ id, name, email, role, status, createdAt, lastSeenAt }`.
  `status` is `deactivated` if `disabled_at` is set, otherwise `active` if the account has a
  password credential, otherwise `invited`. Only `kind = human` accounts are listed or
  reachable: an agent id is a `404`.
- **Link:** `{ url, expiresAt }`, where `url` is `<APP_URL>/accept#<token>`. The token is in
  the **fragment**, which browsers never send to a server, so it cannot end up in access
  logs, proxy logs or a `Referer` header (question 2). It is 32 random bytes from the
  CSPRNG, base64url.
- **Invite:** `name` 1 to 100 trimmed characters, `email` valid (stored lower-cased), `role`
  one of the four human roles (`humanRoleSchema`). In one transaction: insert the account
  (`kind` human, `created_by` the Admin, no credential), insert its link, write the audit
  entry `account.invited` (`data: { role }`). A duplicate email is `409 conflict`.
- **PATCH:** `role` (a human role) and/or `active` (boolean; `false` deactivates, `true`
  reactivates). At least one is required. Each change that actually changes something is
  audited on its own (`account.role_changed` with `{ from, to }`, `account.deactivated`,
  `account.reactivated`); an identical value is a no-op that writes nothing and returns the
  account. A role change or a deactivation deletes the account's `sessions` rows in the same
  transaction (WT-02 decision 8). Deactivation also deletes its unused links.
- **Last Admin (WT-02 decision 9):** a PATCH that would leave no **active** Admin (demoting
  or deactivating the only one) is `409` with the new problem code `last_admin`. The check
  and the change run in one transaction that first takes a transaction-scoped advisory lock
  (as WS-016 does for setup), so two Admins demoting each other at the same moment cannot
  both succeed. An Admin may demote or deactivate themselves when another active Admin
  exists.
- **Reset link:** for an `invited` account it issues a fresh invitation link (kind
  `invitation`), for an `active` one a reset link (kind `reset`); a `deactivated` account is
  `409`. Issuing a link deletes that account's earlier unused links. Audited as
  `account.reset_link_created` (`data: { kind }`, never the token).

### 2. Links (`src/server/services/account-tokens.ts`)

Table `account_tokens`, migration `0005_account_tokens`: `id` uuid pk; `account_id` uuid not
null references `accounts` on delete cascade; `kind` text not null check in
(`invitation`, `reset`); `token_hash` text not null unique (SHA-256 of the token, hex);
`expires_at` timestamptz not null; `used_at` timestamptz null (set by WI-019 when the link
is redeemed); `created_by` uuid not null references `accounts` (restrict); `created_at`.
Index on `account_id`. `issueLink(tx, { accountId, kind, createdBy })` creates the token,
stores only its hash, and returns `{ token, expiresAt }` (7 days). Redeeming a link is
WI-019; this item only issues.

### 3. Pagination (doc 0004 section 5, built here for the first time)

- `src/lib/schemas/pagination.ts`: `paginationQuerySchema` (strict: `limit` coerced to an
  integer from 1 to 100, default 50; `cursor` optional string up to 512 characters) and
  `pageSchema(item)` for `{ items, nextCursor: string | null }`.
- `src/server/http/pagination.ts`: `encodeCursor({ createdAt, id })` and `decodeCursor`,
  base64url JSON; a cursor that does not decode and validate is `invalidRequest` with the
  field error `cursor`. The list reads `limit + 1` rows ordered by `(created_at, id)` and
  continues with `(created_at, id) > (cursor)`, so it stays correct while rows are added.

### 4. Services and routes

`src/server/services/account-management.ts` (`listAccounts`, `inviteAccount`,
`updateAccount`, `issueResetLink`; each takes the acting `Actor`, uses `getDb()` by
default and writes its audit entries in the same transaction) and the three route files:
`api/v1/accounts/route.ts` (`GET`, `POST`), `accounts/[accountId]/route.ts` (`PATCH`),
`accounts/[accountId]/reset-link/route.ts` (`POST`). The new problem code `last_admin` is
added to `PROBLEM_CODES` (doc 0004 section 4 allows a specific code for a status).

## Files

| Path                                                                                   | Change                                     |
| -------------------------------------------------------------------------------------- | ------------------------------------------ |
| `src/lib/schemas/accounts.ts`, `accounts.test.ts`                                      | create: schemas and contracts (test first) |
| `src/lib/schemas/pagination.ts`, `pagination.test.ts`                                  | create (test first)                        |
| `src/lib/schemas/problem.ts`, `problem.test.ts`                                        | modify: `last_admin`                       |
| `src/server/http/pagination.ts`, `pagination.test.ts`                                  | create (test first)                        |
| `src/server/db/schema/account-tokens.ts`, `index.ts`; migration `0005_*`               | create / modify / generated                |
| `src/server/services/account-tokens.ts`, `account-management.ts` (+ integration tests) | create (tests first)                       |
| `src/app/api/v1/accounts/**/route.ts` (+ integration tests)                            | create (tests first)                       |
| `src/lib/openapi/contracts.ts`, `docs/api/openapi.json`                                | modify / regenerate                        |
| `tests/e2e/accounts.spec.ts`, `tests/e2e/seed.ts`                                      | create / modify                            |
| `docs/canonical/0001`, `0004`                                                          | modify: data sketch, pagination as built   |
| `docs/README.md`, WT-02, WI-018, WS-018                                                | statuses                                   |

No new dependencies.

## Data model changes

`account_tokens` as above (migration `0005_account_tokens`). No change to existing tables.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                                                                                                       | Criterion       |
| --- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| 1   | unit        | `paginationQuerySchema`: defaults to 50; accepts 1 and 100; rejects 0, 101, `abc`, an unknown parameter; the page schema has `items` and a nullable `nextCursor`                                                                                           | pagination      |
| 2   | unit        | cursor encode/decode round-trips; garbage, a wrong shape and an over-long cursor are `400` with the field `cursor`                                                                                                                                         | pagination      |
| 3   | unit        | account schemas: invite body strict (name trimmed 1 to 100, email, human role only); patch body needs at least one field and rejects unknown ones and agent roles                                                                                          | input rules     |
| 4   | unit        | `last_admin` is a problem code; the five contracts exist, none is public, `409` is documented where it can occur                                                                                                                                           | OpenAPI         |
| 5   | integration | `issueLink`: stores only a SHA-256 hash (the token is nowhere in the table), expires in 7 days, kind is checked, issuing again deletes earlier unused links                                                                                                | links           |
| 6   | integration | list: humans only, ordered by creation, 3 pages of 2 reproduce the whole list with no repeat or gap, a row inserted between pages does not disturb the rest                                                                                                | list, cursor    |
| 7   | integration | list status: a deactivated account is `deactivated`, one with a password `active`, one without `invited`; an agent is not listed                                                                                                                           | list            |
| 8   | integration | invite: creates the account (lower-cased email, `created_by` the Admin, no credential), returns a link whose token verifies against the stored hash, audits `account.invited` with the Admin as actor, in one transaction (a failing audit leaves nothing) | invite          |
| 9   | integration | invite: a duplicate email is `409` and writes nothing; the token never appears in the audit rows or in any list                                                                                                                                            | invite, secrets |
| 10  | integration | change role: updates, audits `from` and `to`, deletes the account's sessions; the same role is a no-op with no audit and no session deletion                                                                                                               | role            |
| 11  | integration | deactivate and reactivate: set and clear `disabled_at`, audit each, end sessions on deactivation, delete unused links; sign-in then fails and works again                                                                                                  | deactivate      |
| 12  | integration | last Admin: demoting or deactivating the only active Admin is `409 last_admin` (self or by another); with a second active Admin it works; a deactivated Admin does not count                                                                               | last admin      |
| 13  | integration | 2 Admins each demoting the other at once: exactly one succeeds, one active Admin remains                                                                                                                                                                   | race            |
| 14  | integration | reset link: invited gives an invitation link, active a reset link, deactivated `409`; earlier unused links are gone; audited with the kind and no token                                                                                                    | reset link      |
| 15  | integration | routes: Viewer, Member and Manager get `403` on every endpoint, Admin succeeds, no cookie is `401`, a foreign `Origin` on a mutating call is `403` before the body is read                                                                                 | permissions     |
| 16  | integration | routes: `400` per field for bad bodies, query strings and ids; `404` for an unknown id and for an agent id; `415` for non-JSON                                                                                                                             | input rules     |
| 17  | integration | routes: responses and logs contain no password hash or session token; the link appears only in the `201` bodies                                                                                                                                            | secrets         |
| 18  | e2e         | through the running app: Admin invites a person (link returned), lists, changes the role, is refused demoting the last Admin; a signed-in Member is deactivated and their next `GET /me` is `401`                                                          | end to end      |
| 19  | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; `pnpm db:generate` and `pnpm openapi:generate` leave no diff                                                                                                                                      | gate            |

## Risks and open questions

For the owner:

1. **Where reset links are created.** WT-02 lists WI-019 as "accepting an invitation _or
   reset link_", but not who creates the reset link. The invitation and the reset link are
   the same mechanism (a one-time token for an account), so I put its **creation** here,
   next to the invitation, and leave **redemption** (both kinds) to WI-019. Agree? The
   alternative is to leave `reset-link` to WI-019.
2. **Where the token lives in the link.** `<APP_URL>/accept#<token>`, in the fragment, so a
   browser never sends it to the server and it cannot leak through access logs or
   `Referer`. WI-019's page then reads it in the browser and posts it to its API in the
   request body. The usual alternative is `/accept/<token>`, simpler but logged by any
   proxy in front of the app. Agree with the fragment?
3. **What the list shows.** Humans only, with a derived `status` (`invited`, `active`,
   `deactivated`); agents arrive with their own endpoints and permission in WT-05. A
   deactivation or role change ends the person's sessions at once, and an Admin may
   demote or deactivate themselves as long as another active Admin remains. Agree?

Technical, settled by the tests:

4. **Ending sessions.** The change deletes the `sessions` rows directly, in the same
   transaction. Better Auth does not need to know: it finds no session next time. Test 11
   proves the person is signed out.
5. **Serialising Admin changes.** One advisory lock for all role and deactivation changes
   is coarse, but these are rare Admin actions, and it is the simplest thing that is
   provably right (test 13).
