# WI-066 — `maintenance`: remove what has expired

- Status: Done
- Work-track: [WT-12](../work-tracks/WT-12-operations.md) (item E)
- Depends on: WI-062 (the image's one-shot commands), WI-063 (the runtime role)
- Work-spec: [WS-066](../work-specs/WS-066-maintenance.md)

## Outcome

Nothing removes expired sessions or old one-time links today: their rows stay forever.
Rate-limit counters are purged opportunistically, on about one sign-in in fifty (WS-022).
Doc 0006 section 8 decided a `maintenance` command the operator schedules, and the audit of
2026-11-17 (A12) asked that the cleanup's cost be measured before choosing how to run it.

After this item, `node dist/maintenance.mjs` (in development `pnpm maintenance`) deletes:

- sessions whose `expires_at` has passed;
- one-time links used more than 30 days ago, and unused links that expired more than 30
  days ago;
- rate-limit counters whose window has ended;
- expired rows of Better Auth's `verification` table (unused in v1, emptied for the same
  reason).

It prints how many rows of each it deleted and exits `0`. It never touches the audit log,
the task history or comments, writes no audit entry, and runs as the runtime role.

## Acceptance criteria

- [x] Expired sessions are deleted; a live session, and the cookie that uses it, still work.
- [x] A link used 31 days ago is deleted, one used 29 days ago is kept; an unused link
      expired 31 days ago is deleted, an unused link still valid or expired 29 days ago is
      kept.
- [x] Ended rate-limit counters are deleted; a running window's counter is kept.
- [x] Expired `verification` rows are deleted.
- [x] `audit_log`, `task_events` and `comments` keep every row.
- [x] The command prints one line with the four counts and exits `0`; a failure prints
      `describeError` only and exits `1`.
- [x] Run twice in a row, the second run deletes nothing.
- [x] The cost is measured on representative volumes and recorded; an index is added only
      if the measurement asks for one.
- [x] The production smoke test runs it in the image.
- [x] No API contract change. The full quality gate passes.
