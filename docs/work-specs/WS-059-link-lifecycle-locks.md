# WS-059 — One unused link per account, under one lock order

- Status: Done (approved by the owner on 2026-11-18, questions 1 to 4 as proposed)
- Work-item: [WI-059](../work-items/WI-059-link-lifecycle-locks.md)
- Canonical docs: WT-02 decisions 5 and 6 (one-time links, only the newest works);
  [WS-018](WS-018-account-management-api.md) (the Admin lock);
  [WS-024](WS-024-revoke-invitation.md) (the per-account lock and its order);
  [WS-040](WS-040-account-link-hardening.md) (the lock in `issueResetLink`);
  [WS-058](WS-058-session-audit-atomicity.md) (sign-in under the lock); audit of
  2026-11-17, finding A05; `AGENTS.md` hard rule 5

## Approach

### 1. Where things stand (checked on 2026-11-18)

| Operation                           | Admin lock | Account lock | Touches unused links       |
| ----------------------------------- | ---------- | ------------ | -------------------------- |
| `inviteAccount`                     | no         | no           | inserts one (new account)  |
| `issueResetLink`                    | no         | yes, first   | deletes all, inserts one   |
| `acceptLink`                        | no         | yes, first   | uses one, deletes the rest |
| `revokeInvitation`                  | yes, first | yes, second  | cascades with the account  |
| `updateAccount` (deactivate)        | yes, first | **no**       | deletes all                |
| `changeOwnPassword`, `signIn` (058) | no         | yes, first   | none                       |

`inviteAccount` creates the account in the same transaction, so no other transaction can
see it yet; it needs no lock. The gap is `updateAccount`.

### 2. `updateAccount` takes the account lock

After the Admin lock, as the second statement of its transaction, before it reads the
account: `await lockAccount(tx, accountId)`. For every change, not only deactivation: one
rule is simpler to keep than three, and a role change holds the lock only for its own short
transaction.

The order Admin lock → account lock is the one `revokeInvitation()` uses. No operation takes
the account lock and then the Admin lock, so there is no cycle. A comment next to
`lockAccount` states the order.

What this closes:

- **Issue vs deactivate.** If the deactivation commits first, the issue reads
  `deactivated` and answers `409` as today. If the issue commits first, the deactivation
  deletes its link.
- **Accept vs deactivate.** If the deactivation commits first, the locked check in
  `acceptLink` refuses the link (`404`). If the acceptance commits first, the deactivation
  deletes the new sessions; the automatic sign-in after it is refused by WS-058's check.

### 3. A partial unique index as the second line

```ts
uniqueIndex("account_tokens_one_unused_per_account")
  .on(table.accountId)
  .where(sql`${table.usedAt} is null`),
```

Every write path already deletes the unused links before inserting one, so none changes. A
future path that skips the lock fails with a unique violation (`500`) instead of leaving
two valid links.

Migration `0013_…` from `pnpm db:generate`, with one statement added before the index, so
an install that already has duplicates can apply it:

```sql
DELETE FROM "account_tokens" t
WHERE t."used_at" IS NULL
  AND EXISTS (
    SELECT 1 FROM "account_tokens" n
    WHERE n."account_id" = t."account_id" AND n."used_at" IS NULL
      AND (n."created_at", n."id") > (t."created_at", t."id")
  );
```

It keeps the newest unused link of each account (ties broken by `id`) and leaves used links
alone. The deleted links were already meant to be invalid ("only the newest works"). No
audit entry is written for them: the migration is not an actor (open question 2).

### 4. Tests force the order through the lock

`waitForAdvisoryLockWaiter(timeoutMs, count = 1)` gains a `count`: it returns once that many
advisory lock requests are waiting. A test holds `lockAccount` in its own transaction,
starts the operations one after the other, waiting for each to queue, then commits.
PostgreSQL grants a contended lock to its waiters in the order they asked, so the order the
test starts them is the order they commit.

Before the fix, `updateAccount` never waits for the lock, so the tests that queue it time out
("nobody waited"): that is their red.

### Considered and not chosen

- **`SELECT … FOR UPDATE` on the account row instead of the advisory lock**: would mix two
  kinds of lock for the same purpose; every other link path already uses the advisory one.
- **Only the unique index, no lock in `updateAccount`**: the index stops two unused links,
  not a link inserted after a deactivation.
- **Deleting links on reactivation instead**: hides the race and also discards a link an
  Admin issued on purpose after reactivating.

## Files

| Path                                                             | Change                                         |
| ---------------------------------------------------------------- | ---------------------------------------------- |
| `src/server/services/account-management.ts` (+ integration test) | modify: `lockAccount` in `updateAccount`       |
| `src/server/services/account-tokens.ts`                          | modify: the lock-order comment                 |
| `src/server/services/accept-link.integration.test.ts`            | modify: accept vs deactivate                   |
| `src/server/db/schema/account-tokens.ts`                         | modify: the partial unique index               |
| `src/server/db/migrations/0013_*.sql` (+ `meta/`)                | create: dedupe, then the index                 |
| `src/server/db/schema/account-tokens.integration.test.ts`        | create: the index and the dedupe statement     |
| `src/server/auth/testing.ts`                                     | modify: `count` in `waitForAdvisoryLockWaiter` |
| `docs/README.md`, WI-059, WS-059                                 | modify: statuses                               |

## Data model changes

Migration `0013`: a unique index `account_tokens_one_unused_per_account` on
`account_tokens (account_id) WHERE used_at IS NULL`, preceded by the dedupe of section 3.
The existing `account_tokens_account_id_idx` stays (used links are looked up by account
too).

## API contract

None. No new status or error code.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                                                                   | Covers criterion |
| --- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | integration | two `issueResetLink` queued on the held lock, for an account with no unused link and again with one: both resolve; one unused link remains, equal to the second's token hash; two `account.reset_link_created` entries | 1                |
| 2   | integration | issue queued, then deactivation queued; commit: the issue returns a link, then no unused link remains; `account.deactivated` written                                                                                   | 2, 7             |
| 3   | integration | deactivation queued, then issue queued; commit: the issue is refused with `409`, no link and no `account.reset_link_created` written                                                                                   | 2, 7             |
| 4   | integration | deactivation queued, then `acceptLink` queued; commit: `404`, no credential with a hash for the account, the link unused                                                                                               | 3                |
| 5   | integration | `acceptLink` queued, then deactivation queued; commit: the password is set, the account is deactivated and no session remains for it                                                                                   | 3                |
| 6   | integration | an insert of a second unused link for one account fails with a unique violation; a second used link is accepted                                                                                                        | 5                |
| 7   | integration | the dedupe statement on seeded rows (three unused for one account, one unused and two used for another): the newest unused and all used remain                                                                         | 6                |
| 8   | integration | the existing "issue while accept, 20 times" test and every account-management, accept-link, revoke and setup test stay green unchanged                                                                                 | 4                |
| 9   | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; `pnpm openapi:generate` changes nothing; `pnpm db:generate` after the migration changes nothing                                                               | 8                |

## Risks and open questions

For the owner:

1. **`updateAccount` takes the account lock for every change, role changes included**
   (section 2). The alternative is only when deactivating or reactivating. **Recommend:
   every change.**
2. **The migration deletes older duplicate unused links without an audit entry**
   (section 3). They were already supposed to be invalid. The alternative is to mark them
   used (`used_at = now()`), which keeps them visible but makes "used" mean two things.
   **Recommend: delete.**
3. **A violation of the new index answers `500`**, not a specific `409`: it can only come
   from a code path that skipped the lock, which is a bug, not a user error.
   **Recommend: as proposed.**
4. **Ordering tests on PostgreSQL's lock queue.** Waiters for one advisory lock are granted
   in the order they asked, which these tests rely on. If one proves flaky in CI, it falls
   back to asserting only the invariant (at most one unused link, no link after a
   deactivation), not the winner. **Recommend: as proposed.**

## Deviations from the approved spec

1. **`holdAccountLock(accountId)` was added to `src/server/auth/testing.ts`** next to the
   `count` of `waitForAdvisoryLockWaiter`: the tests hold the lock in their own transaction
   through it, instead of each repeating that code.
2. **The schema test file is `src/server/db/schema/account-tokens.integration.test.ts`**, as
   the Files table names it. The dedupe test reads the statement from migration 0013 and runs
   it in a transaction that drops the index, seeds duplicates and rolls back, so it tests the
   SQL that ships.
3. **Test 5 does not assert `signedIn`**: after the acceptance commits, its automatic
   sign-in and the deactivation both wait for the lock, and either may go first. Both orders
   leave no session, which is what the test checks.

## Implementation record

- Red (run before any code changed): 6 tests failed for the right reason. The four that
  queue `updateAccount` timed out ("nobody waited for the advisory lock"); a second unused
  link was accepted; migration 0013 did not exist. The two issue-against-issue tests passed
  already: WS-040 put the lock in `issueResetLink`. They stay as regression checks.
- Green:
  - `updateAccount()` takes `lockAccount` right after the Admin lock.
  - `lockAccount`'s comment lists every caller and the order Admin lock → account lock.
  - The schema gains `account_tokens_one_unused_per_account`. Migration
    `0013_one_unused_link.sql` from `pnpm db:generate`, with the dedupe statement added
    before the index.
- The six ordering tests passed 5 runs out of 5.
- `pnpm openapi:generate`: no change. `pnpm db:generate` after the migration: no change.
- Gate on 2026-11-18: typecheck and lint pass; Prettier on the changed files passes (the
  repo-wide check fails on this Windows checkout's CRLF line endings only); Vitest 1175 of
  1175; `pnpm test:e2e` 68 of 68 with `--retries=0`. Windows, Node 24, pnpm 10.28.0, Compose
  PostgreSQL on port 5433.
