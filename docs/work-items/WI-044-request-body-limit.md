# WI-044 — Request body size limit

- Status: Done
- Work-track: none: a hardening item from the audit of 2026-11-14, done before WT-04
- Depends on: none
- Work-spec: [WS-044](../work-specs/WS-044-request-body-limit.md)

## Outcome

Every JSON request body is bounded. `readJson` counts the bytes as it reads them and refuses
a body larger than the budget with `413 payload_too_large`, before any service runs, whatever
the `Content-Length` header says or whether there is one. API requests no longer go through
the page proxy, so Next.js no longer buffers up to 10 MB of each request body before the
route sees it. Every operation that takes a JSON body documents the `413`.

## Acceptance criteria

- [x] A JSON body up to the budget is read and validated exactly as before.
- [x] A larger body gets `413` with a problem body (`application/problem+json`, code
      `payload_too_large`, a request id), whether it declares its length, declares a wrong
      one, or is sent in chunks without one; at most the budget plus one chunk is read.
- [x] The budget counts bytes, not characters.
- [x] A refused request writes nothing: no audit entry, no rate-limiter count, also on the
      public sign-in and setup endpoints.
- [x] Malformed JSON stays `400`, a wrong content type stays `415`, and a body that breaks
      off half way is `400`, not `500`.
- [x] The page proxy no longer runs for `/api/` requests; pages keep their session redirect
      and Content Security Policy unchanged.
- [x] Every operation that documents `415` also documents `413`, enforced by a test; the
      OpenAPI document is regenerated; canonical doc 0004 lists the new status and code.
- [x] The full quality gate passes.

## Notes

Found by the audit of 2026-11-14 (finding A-03). An earlier version of this item exists on
the unmerged branch `claude/wi-044-request-body-limit`, written for older code; this one
replaces it.
