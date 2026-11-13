# WS-024 — Revoke an invitation that was never accepted

- Status: Approved (approved by the owner on 2026-11-13, all open questions accepted as proposed)
- Work-item: [WI-024](../work-items/WI-024-revoke-invitation.md)
- Canonical docs: [0004](../canonical/0004-api-conventions.md) sections 3, 4, 7;
  [WT-02](../work-tracks/WT-02-accounts-and-permissions.md) decisions 3, 5, 9;
  [WS-018](WS-018-account-management-api.md), [WS-019](WS-019-accept-invitation-or-reset-link.md),
  [WS-020](WS-020-people-page.md), [WS-023](WS-023-api-guard-rails.md);
  `AGENTS.md` hard rules 4 to 9

## Approach

### 1. What "revoke" means

An invitation is "never accepted" when the account has **no password credential**. That is
the same test the people list uses for the status `invited` (WS-018), except that it also
covers an invited account that was later deactivated: it never had a password either.

Revoking **deletes the account row**. Its `credentials` (none), `sessions` (none) and
`account_tokens` go with it through the existing `on delete cascade`; `accounts.created_by`
of anyone it invited is `set null` (it cannot have invited anyone). No migration is needed.
Deleting is the only way to free the email: a human account must have one (database check
of WS-013), and `accounts.email` is unique.

Deleting is safe because an account without a password never acted: it has no rows in
`audit_log.actor_account_id` and created no links (both `on delete restrict`). Entries
_about_ it (`account.invited`, `account.reset_link_created`) keep its id in `entity_id`,
which is text, not a foreign key, so the history stays.

### 2. Endpoint

`DELETE /api/v1/accounts/{accountId}/invitation`, needs `accounts:manage` (Admin).

| Path params     | Success | Errors                            |
| --------------- | ------- | --------------------------------- |
| `{ accountId }` | `204`   | `400`, `401`, `403`, `404`, `409` |

The handler calls `assertSameOrigin`, `authenticate`, `requirePermission(actor,
"accounts:manage")`, reads `accountIdParamsSchema` (existing), and calls the service. No
body. `409` uses the base code `conflict` with the detail "This person has already accepted
their invitation. Deactivate the account instead." `404` for an unknown id or an agent.

### 3. Service (`revokeInvitation` in `src/server/services/account-management.ts`)

`revokeInvitation(actor, accountId, db = getDb())`, in one transaction:

1. `requirePermission(actor, "accounts:manage")`, then take the existing
   `ADMIN_CHANGE_LOCK_KEY` advisory lock: revoking an invited Admin changes who counts as an
   Admin (section 4), so it is serialised with role changes and deactivations.
2. Take a **per-account advisory lock**, `pg_advisory_xact_lock(ACCOUNT_LOCK_SPACE,
hashtext(account_id))` (the two-integer form, a key space apart from the single-key
   Admin lock). `acceptLink` (WS-019) takes the same lock as soon as it knows the account,
   before it locks any row (see below). Row locks alone are not enough: the acceptance
   locks its link and then deletes the account's other links, so any order the revocation
   chose for "links, then account" could still deadlock with it.
3. Load the human account; none: `notFound()`.
4. If a credential with a password hash exists: `conflict(...)`.
5. Write `account.invitation_revoked` (entity the account, `data: { role }`, the same shape
   as `account.invited`), then delete the account.

**Change to `acceptLink`:** inside its transaction it first reads the link's `account_id`
by token hash without a lock; if there is one it takes the same advisory lock, then runs its
existing `select ... for update` and everything after it unchanged. The helper
`lockAccount(tx, accountId)` lives in `src/server/services/account-tokens.ts`, which both
services already import.

The race, both orders: if the acceptance commits first, the revocation then sees a password
and answers `409`; if the revocation commits first, the acceptance's locked read of the link
finds no row and answers its usual `404 invalid_link`.

### 4. The last-Admin rule counts only Admins who can sign in

`updateAccount` (WS-018) counts "other active Admins" as Admin accounts that are not
deactivated, which **includes invited Admins with no password**. So today the only real
Admin can demote or deactivate themselves while an invited Admin exists; if that invitation
then expires or is lost, nobody can manage the install. Revocation makes this easy to reach
(demote yourself, then the invitation is revoked), so this item fixes it: the count adds
"has a password credential". The check stays under the same advisory lock. Revoking an
invited Admin itself never needs the check, because that account never counted.

### 5. People page

- `src/components/people/api.ts`: `revokeInvitation(accountId)` sends `DELETE` and expects
  `204`.
- `people-table.tsx`: for a row whose status is `invited`, a "Revoke invitation" item next to
  "New invitation link" and "Deactivate", wired like `onDeactivate`.
- `people-page.tsx`: a new `Confirmation` kind `revoke`, using the existing alert dialog:
  title "Revoke the invitation of {name}?", text "Their link stops working and the account is
  removed. {email} can be invited again." and a destructive "Revoke" button. On `204` the row
  is removed and the status line says "The invitation of {name} was revoked." On `409` (the
  person accepted in the meantime) it reloads the list and says "{name} has already accepted
  the invitation." Anything else: "Could not revoke. Try again."
- The invite dialog's line "Check the email: it cannot be changed later." becomes "Check the
  email. If it is wrong, revoke the invitation and invite again."

### 6. Existing code touched

`src/lib/schemas/audit.ts` (the action `account.invitation_revoked`),
`src/lib/schemas/accounts.ts` (the contract) and `src/lib/openapi/contracts.ts`,
`account-management.ts` (new function and the last-Admin count), `account-tokens.ts` and
`accept-link.ts` (the per-account lock), the People components. The
WS-023 test covers the new route without change: it is state-changing, not public, and not
authentication-only, so it must call all three checks.

## Files

| Path                                                                                                               | Change                            |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| `src/server/services/account-management.ts`, `account-management.integration.test.ts`                              | modify (tests first)              |
| `src/server/services/account-tokens.ts`, `accept-link.ts`                                                          | modify: `lockAccount`, used first |
| `src/app/api/v1/accounts/[accountId]/invitation/route.ts`, `route.integration.test.ts`                             | create (tests first)              |
| `src/app/api/v1/accounts/permissions.integration.test.ts`                                                          | modify: the new operation         |
| `src/lib/schemas/accounts.ts`, `accounts.test.ts`                                                                  | modify: contract                  |
| `src/lib/schemas/audit.ts`, `audit.test.ts`                                                                        | modify: new action                |
| `src/lib/openapi/contracts.ts`, `docs/api/openapi.json`                                                            | modify / regenerate               |
| `src/components/people/api.ts`, `people-table.tsx`, `people-page.tsx`, `invite-dialog.tsx`, `people-page.test.tsx` | modify (tests first)              |
| `tests/e2e/people.spec.ts`                                                                                         | modify: revoke and invite again   |
| `docs/README.md` (follow-up resolved), WT-02, WI-024, WS-024                                                       | modify: statuses                  |

No new dependency and no migration.

## Data model changes

None. The cascades and `set null` needed already exist.

## API contract

See section 2. `public: false`, needs `accounts:manage`; `401` and `403` are documented
automatically (doc 0004 section 7).

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                                  | Criterion      |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 1   | unit        | the contract is authenticated, documents `204`, `404` and `409`; `account.invitation_revoked` is an audit action; the guard-rail and contracts-versus-routes tests pass               | OpenAPI, audit |
| 2   | unit        | People page: an invited row offers "Revoke invitation", an active or deactivated-after-accepting row does not                                                                         | UI             |
| 3   | unit        | People page: revoking asks first and says the email will be free; confirming sends `DELETE` to the right URL, removes the row and reports it; `409` reloads and says so; other errors | UI             |
| 4   | unit        | invite dialog: the new line about revoking a wrong email                                                                                                                              | UI             |
| 5   | integration | service: an invited account is gone with its links; `account.invitation_revoked` with the Admin as actor and `{ role }`; the email can be invited again; earlier entries stay         | revoke         |
| 6   | integration | service: an invited account that was deactivated can be revoked; an active account and a deactivated one with a password are `409`, nothing changed, no audit row                     | 409            |
| 7   | integration | service: unknown id and an agent account are `404`; a non-Admin actor is `403`                                                                                                        | 404, 403       |
| 8   | integration | the revoked link is refused by `acceptLink` with `404 invalid_link`                                                                                                                   | link           |
| 9   | integration | race: 10 rounds of revoke and accept of the same invitation at once; each round ends with exactly one winner, the loser gets `409` or `404 invalid_link`, never another error         | race           |
| 10  | integration | a trigger that fails the audit insert leaves the account and its link in place                                                                                                        | atomic         |
| 11  | integration | last Admin: with one Admin and one invited Admin, the Admin can no longer demote or deactivate themselves (`409 last_admin`); after the invited one accepts, they can                 | last Admin     |
| 12  | integration | route: `204`; `404`; `409`; `400` for a malformed id; `401` without a session; `403` for each non-Admin role and for a foreign `Origin` before anything is done                       | route          |
| 13  | e2e         | an Admin invites a mistyped email, revokes it on the People page, the link is refused in a fresh browser, and the same email can be invited again                                     | end to end     |
| 14  | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; `pnpm db:generate` and `pnpm openapi:generate` leave no diff                                                                 | gate           |

## Risks and open questions

For the owner:

1. **Revoking deletes the account.** It is the only way to free the email without a schema
   change, and it is safe because the account never acted. The alternative is a
   `revoked_at` column plus a partial unique index on the email of non-revoked accounts: a
   migration, and every query that reads accounts must then skip revoked ones. I recommend
   deleting. Agree?
2. **Path and verb: `DELETE /api/v1/accounts/{accountId}/invitation`.** It says what is
   removed (the invitation) and cannot be mistaken for "delete any account", which v1 does
   not offer. The alternative, `DELETE /api/v1/accounts/{accountId}` limited to invited
   accounts, reads as a general delete. Agree?
3. **The audit entry keeps the role, not the name or email.** Once the account is deleted the
   log no longer says who it was, only that an invitation with that id and role was revoked
   by that Admin. That matches WS-021's choice to keep personal data out of the append-only
   log. The alternative is `{ role, email }`, which would let an Admin see which mistyped
   address it was. I recommend role only. Agree?
4. **The last-Admin fix (section 4) is part of this item.** It is a gap in WI-018 found while
   writing this spec, and revocation makes it reachable. The alternative is its own item
   right after. I recommend including it, since the race test and the revocation need the
   corrected count. Agree?

Technical, settled by the tests:

5. **One lock per account, taken first.** The revocation and the acceptance both take the
   per-account advisory lock before any row lock, so they cannot deadlock (test 9 runs them
   together ten times, and the existing acceptance race test of WS-019 must stay green). If
   a deadlock still shows up, I stop and report.
6. **No `revoked` status in the list.** The row simply disappears; the People page reloads
   on `409`, so a stale page cannot show a revoked invitation as still pending for long.
