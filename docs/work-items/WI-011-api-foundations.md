# WI-011 — API foundations: errors, validation helpers, request id

- Status: Done (approved by the owner on 2026-11-12)
- Work-track: [WT-02](../work-tracks/WT-02-accounts-and-permissions.md)
- Depends on: canonical doc [0004](../canonical/0004-api-conventions.md)
- Work-spec: [WS-011](../work-specs/WS-011-api-foundations.md)

## Outcome

The rules of canonical doc 0004 that apply to every endpoint exist as shared, tested code,
so that the first authenticated endpoints (WI-015) are written against them instead of
each inventing its own error handling. After this item, a route handler can declare its
input schemas, throw a typed error, and get a correct problem-details response without
writing any of that itself.

No endpoint is added for users or agents, and the two existing endpoints keep their
behaviour.

## Acceptance criteria

- [x] There is one Zod schema for the problem-details error body of doc 0004 section 4,
      and every error produced by the shared code parses with it.
- [x] A route handler wrapped with the shared wrapper returns, for a thrown API error,
      the status, `code` and `detail` of that error as `application/problem+json`.
- [x] An unexpected exception becomes a `500` with code `internal_error`; the response
      contains none of the exception's message or stack, and the exception is logged
      server-side together with the request id.
- [x] A JSON body that is malformed, or that fails its Zod schema, becomes a `400` with
      code `invalid_request` and one `errors` entry per failing field, with dotted paths.
      Rejected values are never echoed back.
- [x] A body-carrying request whose content type is not JSON becomes a `415`.
- [x] Query strings are validated the same way as bodies.
- [x] Every response from a wrapped handler, success or error, has an `X-Request-Id`
      header and `Cache-Control: no-store`; error bodies repeat the id as `requestId`.
- [x] A request to an unknown path under `/api/` returns the `404` problem body, not HTML.
- [x] Endpoint contracts can describe request bodies, query and path parameters, and
      error responses; the generated OpenAPI document shows error responses as
      `application/problem+json` and adds `401` and `403` to every non-public operation.
- [x] `docs/api/openapi.json` is regenerated; the health and OpenAPI endpoints are
      unchanged in behaviour.
- [x] The full quality gate passes.

## Notes

Pagination helpers (doc 0004 section 5) are not part of this item. They are built with the
first list endpoint (WI-018), when there is a real table to test keyset cursors against.

Authentication, the origin check and rate limiting (doc 0004 section 7) are WI-015.
