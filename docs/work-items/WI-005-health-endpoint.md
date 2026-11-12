# WI-005 — Health endpoint: the first vertical slice

- Status: Done
- Work-track: [WT-01](../work-tracks/WT-01-project-boilerplate.md)
- Depends on: WI-004
- Work-spec: [WS-005](../work-specs/WS-005-health-endpoint.md)

## Outcome

`GET /api/v1/health` reports whether the app can reach its database. It is small on
purpose: its real value is being the first piece of code that goes through every layer in
`AGENTS.md` section 3 (Zod schema, route handler, service, database), so that later
features have a worked, tested pattern to copy. It is also what Docker, CI and uptime
checks will call.

## Acceptance criteria

- [x] `GET /api/v1/health` returns `200` and `{ "status": "ok", "database": "up" }` when
      the database answers.
- [x] It returns `503` and `{ "status": "degraded", "database": "down" }` when the
      database does not answer within the timeout, and never hangs.
- [x] The response body is defined by a Zod schema in `src/lib/schemas`, and the handler's
      output is validated against it in tests.
- [x] The response is never cached and is computed per request (not at build time).
- [x] The response exposes nothing beyond those two fields: no versions, hostnames or
      error text.
- [x] The route handler contains no database access; the service contains no HTTP
      concerns.
- [x] The full existing quality gate passes.

## Notes

The endpoint is public (no authentication). See the question in WS-005 about
`AGENTS.md` hard rule 6.
