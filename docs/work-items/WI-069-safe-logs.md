# WI-069 — No request data in the logs when a query fails

- Status: Done
- Work-track: [WT-12](../work-tracks/WT-12-operations.md) (item H)
- Depends on: WI-062 (the image, the smoke test), WS-042 (`describeError`)
- Work-spec: [WS-069](../work-specs/WS-069-safe-logs.md)

## Outcome

WS-042 made Opanel's own error logs safe: a failed request logs `describeError`, never the
message of a failed query, which holds its parameters. It left Better Auth's and Next.js's
own logs unexamined (WS-042, question 2), and doc 0006 section 10 asked for that check
before the operations guide states what the logs may contain.

The check was made on 2026-11-19 on the example install: with the runtime role's rights on
`sessions` taken away, a page, an API call and a sign-in each made by a signed-in browser
answered `500`, and the app's log held **the session token of the request six times**:

- Better Auth logged `INTERNAL_SERVER_ERROR` with the whole Drizzle error,
  `Failed query: … where "sessions"."token" = $1` then `params: <token>`;
- Next.js logged the error of the page render (`⨯ [Error [APIError]: Failed to get
session]`) with the same error as its `cause`.

The token is a credential: whoever reads the logs could use the session (AGENTS.md hard
rule 7). Opanel's own line for the API call (`Request … failed: APIError code=42501`) was
safe, but the one for the sign-in named the error class `sh`, the minified name of the
database driver's error.

After this item, whatever fails, the production server's log describes an error only as
`describeError` does: its class, its code, its constraint name.

## Acceptance criteria

- [x] Better Auth's errors are logged as one `describeError` line, never with their
      message, cause, query or parameters.
- [x] In production, every `Error` written to the console by any code in the server
      process (Next.js, Better Auth, Opanel) is written as `describeError`; text and other
      values are written as they are.
- [x] Development and tests keep the full errors, stacks included.
- [x] A failed query's class is named in the production build (`DrizzleQueryError`, not a
      minified name).
- [x] The production smoke test repeats the check above: with the runtime role's rights on
      `sessions` taken away, a page, an API call and a sign-in with a session cookie leave
      neither the token nor `params:` in the app's log; with the rights back, the app works
      again.
- [x] No API contract change. The full quality gate and the image workflow pass.

## Notes

- The operations guide, which this item was found while drafting, becomes WI-070 (WT-12
  item I).
