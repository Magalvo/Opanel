# WI-059 — One unused link per account, under one lock order

- Status: Done
- Work-track: none: a hardening item from the audit of 2026-11-17 (finding A05, what WS-040
  left open)
- Depends on: WI-040 (merged; it put the per-account lock in `issueResetLink`)
- Work-spec: [WS-059](../work-specs/WS-059-link-lifecycle-locks.md)

## Outcome

WS-040 made issuing a link take the per-account lock, so two issues for one account no
longer interleave. Three gaps remain:

- **Deactivating does not take that lock.** `updateAccount()` takes only the Admin lock.
  An issue that read the account as active before the deactivation committed inserts its
  link afterwards, past the deactivation's delete of unused links. The link is refused while
  the account is deactivated, but it works again if the account is reactivated within its 7
  days. The audit says "deactivated", and the deactivation promised to end the links.
  An acceptance can also set a password on an account whose deactivation commits in the
  same moment.
- **Nothing in the database holds the rule.** Only `token_hash` is unique. A future code
  path that inserts a link without the lock would bring back two valid links silently.
- **No test races issuance.** The existing test runs issue against accept, and found no
  difference before or after the fix (WS-040, implementation record).

After this item:

- every account change (`updateAccount`: deactivation, reactivation, role) takes the
  per-account lock, after the Admin lock and before any row lock, the order
  `revokeInvitation()` already uses;
- a partial unique index allows at most one unused link per account; the migration first
  keeps only the newest unused link of each account;
- integration tests force each race through the lock and check the links and audit
  entries left.

## Acceptance criteria

- [x] Two `issueResetLink` for one account, run together, with and without an earlier
      link: both succeed, exactly one unused link remains, and it is the one the second to
      commit returned; two `account.reset_link_created` entries are written.
- [x] An issue and a deactivation of one account, run together in either order: when the
      deactivation commits last, no unused link remains; when the issue commits last, it is
      refused with `409` and writes nothing.
- [x] An acceptance and a deactivation of one account, run together: when the deactivation
      wins, the link is refused with `404` and no password is set; when the acceptance
      wins, the deactivation then removes the new sessions.
- [x] Issue against acceptance keeps its existing guarantee (one of the two links is the
      survivor, no deadlock).
- [x] The database refuses a second unused link for an account (unique violation), and
      allows any number of used ones.
- [x] The migration keeps the newest unused link of each account and deletes the older
      unused ones; used links are untouched. Migration 0005 is not edited.
- [x] `updateAccount` takes the per-account lock after the Admin lock; no operation takes
      them in the other order.
- [x] No API contract change. The full quality gate passes.

## Notes

`inviteAccount` needs no lock: it creates the account in the same transaction, so no other
transaction can see it yet.
