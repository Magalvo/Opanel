# WI-042 — Safe error logging

- Status: Proposed (awaiting owner approval)
- Work-track: none: a hardening item from the audit of 2026-11-14, done before WT-04
- Depends on: none (its branch is stacked on WI-044, which touches the same files)
- Work-spec: [WS-042](../work-specs/WS-042-safe-error-logging.md)

## Outcome

When a request or the health check fails unexpectedly, the server's log line names the
error without repeating its message. Today it logs `error.message`, and the installed ORM
puts the failed query and its parameters in that message, so a log line can hold an email,
a task description or a password hash (`AGENTS.md` hard rule 7). After this item a line
holds only the request id, the error's class name and, when present, the database error
code and constraint name.

## Acceptance criteria

- [ ] An unexpected error in a request is logged as `Request <id> failed: <description>`,
      where the description holds only an allowed class name, a database or system error
      code and a constraint name; never the message, query, parameters, detail or stack.
- [ ] A real database failure caused by a value, such as a duplicate email or a password
      hash in a failed insert, produces a line without that value or the SQL.
- [ ] The health check logs `database unreachable (<description>)` under the same rule.
- [ ] The response to the client is unchanged: the same generic `500` problem with the same
      request id; expected API errors are still not logged.
- [ ] Canonical doc 0004 states the logging rule.
- [ ] The full quality gate passes.

## Notes

Found by the audit of 2026-11-14 (finding A-04). An earlier version of this item exists on
the unmerged branch `claude/wi-042-safe-error-logging`, written for older code; this one
replaces it.
