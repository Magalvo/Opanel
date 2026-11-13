# WI-023 — API guard rails: declared authentication and enforced checks

- Status: Done (approved by the owner on 2026-11-13)
- Work-track: [WT-02](../work-tracks/WT-02-accounts-and-permissions.md)
- Depends on: WI-015
- Work-spec: [WS-023](../work-specs/WS-023-api-guard-rails.md)

## Outcome

Two gaps found in the review of 2026-11-12 are closed before more endpoints are added.

1. The OpenAPI document does not say which operations need credentials or how they are
   sent, so an agent author reading it cannot tell a protected endpoint from a public one.
2. Authentication, the permission check and the same-origin check are each a line that
   every route handler must remember to write. All current handlers do, but nothing fails
   if the next one forgets, and `AGENTS.md` hard rule 6 depends on it.

## Acceptance criteria

- [x] The OpenAPI document declares the session cookie as a security scheme, and every
      non-public operation requires it. Public operations keep `security: []`.
- [x] A test fails if a route handler for a non-public contract does not authenticate.
- [x] The same test fails if such a handler has no permission check, unless the operation
      is on a short, explicit list of authentication-only operations (`GET /api/v1/me`,
      `POST /api/v1/auth/sign-out`, as approved in WS-015).
- [x] The same test fails if a handler for `POST`, `PUT`, `PATCH` or `DELETE` does not
      apply the same-origin check, public or not.
- [x] The test's failure message names the route file and what is missing.
- [x] `docs/api/openapi.json` is regenerated. No endpoint changes behaviour.
- [x] The full quality gate passes.

## Notes

Closes the follow-up "Declare the security schemes in the OpenAPI document" in
`docs/README.md`. The bearer-token scheme is added by WT-05, together with tokens.
