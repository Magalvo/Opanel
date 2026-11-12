# WI-014 — Audit log table and writer

- Status: Proposed
- Work-track: [WT-02](../work-tracks/WT-02-accounts-and-permissions.md)
- Depends on: [WI-013](WI-013-accounts-and-better-auth.md)
- Work-spec: [WS-014](../work-specs/WS-014-audit-log.md)

## Outcome

`AGENTS.md` hard rule 8 ("every state-changing action records the acting account in the
audit log") can be followed. There is one `audit_log` table, one function that writes to
it, and a guard that keeps secrets out of it. Every later item that changes state (sign-in,
account management, and in later tracks tasks, tokens and agents) calls that one function,
in the same database transaction as the change.

No endpoint, page or UI is added: reading the audit log is not part of WT-02.

## Acceptance criteria

- [ ] A migration creates `audit_log` with the columns of doc 0001 section 7, indexed for
      lookups by entity and by actor.
- [ ] `recordAudit` writes one row naming the acting account, the action, the entity and
      the entity id, optional structured data, and the time.
- [ ] The row is written through the caller's database transaction: if that transaction
      rolls back, no audit row remains; if it commits, the row is there.
- [ ] Actions are a closed list validated by Zod; an unknown action is rejected before
      anything is written.
- [ ] Audit data that contains a secret-looking key (password, secret, token, hash,
      authorization, cookie), at any depth, or that is larger than 8 KiB, is rejected
      before anything is written, and the error never contains the offending value.
- [ ] The log is append-only: updating or deleting a row fails at the database.
- [ ] An actor is recorded only if it is a real account, and an account that has audit
      rows cannot be deleted.
- [ ] An event with no actor (for example a failed sign-in) must say so explicitly; the
      actor cannot be left out by accident.
- [ ] Doc 0001's data sketch matches the table.
- [ ] The full quality gate passes.

## Notes

Not in this item: any endpoint or page that lists the audit log; the callers themselves
(each item of WT-02 that changes state adds its own call and test); retention or
export of the log.
