# WI-042 — Safe error logging

- Status: Done
- Work-track: [WT-03](../work-tracks/WT-03-board-core.md) (found in the audit of 2026-11-14,
  finding A-04; the code it touches was built in WT-01 and WT-02)
- Depends on: none
- Work-spec: [WS-042](../work-specs/WS-042-safe-error-logging.md)

## Outcome

An unexpected error is logged with enough to diagnose it (request id, error class, and the
PostgreSQL error code when there is one) and with none of its message text. Today the
route wrapper and the health check log `error.message`, and the installed
`drizzle-orm@0.45.4` builds the message of a failed query as
`Failed query: <sql>\nparams: <parameters>`, so a failed insert into `credentials` writes
the password hash into the log (`AGENTS.md` hard rule 7).

## Acceptance criteria

- [x] A real failing query whose parameter is a marker string leaves no trace of the marker
      in the response or in what the logger receives.
- [x] The log line still carries the request id, the error's class name and, for a
      PostgreSQL error, its five-character code and constraint name.
- [x] No `message`, `cause` text, query text, parameter or stack trace is logged by the
      route wrapper or by the health check.
- [x] The response to the client does not change.
- [x] Canonical doc 0004 states the logging rule.
- [x] The full quality gate passes.

## Notes

This is the audit's highest-priority item, because the installed version was confirmed to
include the parameters in the message. If the owner prefers a different order, it should
still go first.
