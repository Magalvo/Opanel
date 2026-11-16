# WS-044 — Request body size limit

- Status: Approved (approved by the owner on 2026-11-16, questions 1 to 5 as proposed)
- Work-item: [WI-044](../work-items/WI-044-request-body-limit.md)
- Canonical docs: [0004](../canonical/0004-api-conventions.md) sections 3 and 4; `AGENTS.md`
  hard rules 4, 9 and 13; [WS-011](WS-011-api-foundations.md) (`readJson`),
  [WS-017](WS-017-sign-in-page-and-protected-shell.md) and
  [WS-041](WS-041-security-headers.md) (the proxy)

## Approach

`readJson` (`src/server/http/route.ts`) calls `request.json()`, which buffers the whole body
before Zod sees it. The `max` lengths in the schemas bound the validated fields, not the
memory used to receive the document, and `readJson` also serves public endpoints (sign-in,
setup, accepting a link). Read for the installed Next.js 16.4.6 (hard rule 13):
`proxyClientMaxBodySize.md` and `proxy.md`.

### 1. The budget (question 1)

`MAX_JSON_BODY_BYTES = 512 * 1024` (524 288 bytes), one constant for every JSON endpoint, in
`src/server/http/route.ts`. The largest fields today are task and epic descriptions, 50 000
characters each. In JSON a character takes at most 6 bytes (a control character becomes
`\u00XX`), so 300 000 bytes in the worst case, plus a few kilobytes for the other fields.
512 KiB covers every valid request with room, and caps the memory a request can take. A
later field that needs more changes the constant in its own work-spec (question 2).

### 2. `readJson`, in this order

1. Not `application/json`: `415`, as today.
2. `Content-Length`, if it is a plain non-negative integer larger than the budget: `413` at
   once, without reading. A missing or malformed header is ignored; it is never trusted to
   mean the body is small.
3. Read `request.body` with a reader, adding up the bytes of each chunk. When the total
   passes the budget, cancel the reader and throw `413`. Nothing more is buffered, so a
   wrong `Content-Length` or chunked encoding is harmless.
4. A body that cannot be read (the client disconnects half way) is `400`, not `500`.
5. Decode as UTF-8 (`TextDecoder`, which drops a byte order mark as `request.json()` does)
   and parse. Malformed JSON is `400` with today's message, and the value goes to the same
   `validate` step.

The error is `payloadTooLarge()` in `src/server/http/errors.ts`: status `413`, title
`Content Too Large`, code `payload_too_large`, detail "The request body is too large." The
detail does not repeat the limit; it is documented. `payload_too_large` joins
`PROBLEM_CODES` in `src/lib/schemas/problem.ts`.

`413` is thrown inside `readJson`, before the handler calls its service, so a refused
request writes nothing: no audit entry, no limiter count.

### 3. API requests skip the page proxy (question 3)

`src/proxy.ts` runs for every path except static files, `/api/` included, although it hands
API requests on untouched (WS-041). With a proxy in place, the installed Next.js buffers each
request body in memory, up to `proxyClientMaxBodySize` (10 MB by default), before the route
handler runs; above that it silently truncates the body and carries on. So today a client
can make the server hold 10 MB per request whatever `readJson` does.

The proxy's matcher therefore excludes `api/`, so API requests never enter it:
`/((?!api/|_next/static|_next/image|favicon.ico).*)`. Nothing changes for them: the proxy
already returned them untouched, the API authenticates every request itself (doc 0004
section 7), and `nosniff` and the referrer policy come from `next.config.ts`, not the
proxy. The proxy's early return for `/api/` stays, as a second guard. Pages keep the session
redirect and the policy. Setting `proxyClientMaxBodySize` instead was not chosen: it is
experimental, and over its limit it truncates rather than refuses.

### 4. Contracts and documentation

Every operation that takes a JSON body documents `415` (21 today, in `accounts`, `auth`,
`columns`, `comments`, `epics`, `projects`, `tasks` and `teams`). Each gets
`413: PAYLOAD_TOO_LARGE`, a shared response in `src/lib/openapi/responses.ts` beside
`versionConflictResponse`. A test in `src/lib/openapi/routes.test.ts` asserts that every
contract documenting `415` also documents `413`, and the reverse, so a new endpoint cannot
forget it. Canonical doc 0004 gains `413` in its status table and `payload_too_large` in its
codes. `pnpm openapi:generate` is run and its diff committed.

### 5. The reverse proxy

The application cannot know the operator's reverse proxy limit. The production deployment
follow-up in `docs/README.md` gets one line: the proxy must accept bodies of at least this
budget and should refuse larger ones itself.

## Files

| Path                                                                             | Change                                          |
| -------------------------------------------------------------------------------- | ----------------------------------------------- |
| `src/server/http/route.ts` (+ `route.test.ts`)                                   | modify: bounded `readJson` (tests first)        |
| `src/server/http/errors.ts` (+ `errors.test.ts`)                                 | modify: `payloadTooLarge` (tests first)         |
| `src/lib/schemas/problem.ts` (+ test)                                            | modify: `payload_too_large`                     |
| `src/lib/openapi/responses.ts`                                                   | modify: `PAYLOAD_TOO_LARGE`                     |
| `src/lib/schemas/{accounts,auth,columns,comments,epics,projects,tasks,teams}.ts` | modify: `413` beside every `415`                |
| `src/lib/openapi/routes.test.ts`                                                 | modify: the `413` with `415` rule (test first)  |
| `src/proxy.ts` (+ `proxy.test.ts`)                                               | modify: the matcher excludes `api/`             |
| `src/app/api/v1/auth/sign-in/route.integration.test.ts`                          | modify: refused before the service (test first) |
| `tests/e2e/body-limit.spec.ts`                                                   | create (against the running server)             |
| `docs/canonical/0004-api-conventions.md`                                         | modify: status and code                         |
| `docs/api/openapi.json`                                                          | regenerate                                      |
| `docs/README.md`, WI-044, WS-044                                                 | statuses; the reverse proxy line                |

No new dependency, no migration.

## Data model changes

None.

## API contract

A new response on every operation that takes a JSON body: `413`, problem body, code
`payload_too_large`. No existing response changes, and a request within the budget behaves
exactly as before. It adds a response for a new situation, which doc 0004 section 8 allows
within v1.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                                      | Covers criterion |
| --- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit        | `payloadTooLarge()`: status 413, title, code `payload_too_large`, a detail that does not state the limit; the code is in `PROBLEM_CODES`                                                  | error            |
| 2   | unit        | a body exactly at the budget, and one byte under, is parsed and validated as before                                                                                                       | within budget    |
| 3   | unit        | one byte over with a correct `Content-Length`: `413`, and the body stream was not read                                                                                                    | early refusal    |
| 4   | unit        | over the budget with no `Content-Length` (a stream): `413`, and the stream was cancelled after at most the budget plus one chunk                                                          | counted          |
| 5   | unit        | `Content-Length` says 10 while the stream sends more than the budget: `413`                                                                                                               | wrong header     |
| 6   | unit        | a `Content-Length` of `abc` or `-1` is ignored: a small body passes, a large one is `413`                                                                                                 | malformed header |
| 7   | unit        | 200 000 three-byte characters (600 000 bytes, fewer than 524 288 characters): `413`; the test states the byte count                                                                       | bytes            |
| 8   | unit        | malformed JSON within the budget is `400` with today's message; a stream that errors half way is `400`; a wrong content type is still `415`, checked first                                | no regression    |
| 9   | unit        | a byte order mark and a multibyte body parse as `request.json()` would                                                                                                                    | same parsing     |
| 10  | integration | `POST /api/v1/auth/sign-in` with an oversized body: `413`, and no audit entry and no limiter row are written                                                                              | nothing written  |
| 11  | unit        | every contract that documents `415` also documents `413`, and the reverse; the generated OpenAPI document has the `413` with the problem schema and stays valid                           | contracts        |
| 12  | unit        | proxy matcher: `/api/v1/health` and `/api/v1/tasks/OPA-1` are not matched; pages are; the existing page tests (redirect, policy) are unchanged                                            | proxy            |
| 13  | e2e         | against the running app: the budget plus one byte posted to `/api/v1/auth/sign-in` gets `413` with `application/problem+json` and a request id; a small body still gets the normal answer | real transport   |
| 14  | e2e         | the same with chunked transfer encoding and no `Content-Length`, sent with a raw Node `http` request                                                                                      | real transport   |
| 15  | e2e         | a body of 11 MB (above Next.js's proxy buffer) is refused with `413`, not truncated and answered `400`                                                                                    | proxy            |
| 16  | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; `pnpm openapi:generate` leaves no diff after the change; `pnpm db:generate` leaves none                                          | gate             |

Tests 13 to 15 are there because a constructed `Request` does not exercise the framework's
handling of the real transport.

## Risks and open questions

For the owner:

1. **The value: 512 KiB**, derived in section 1 from the largest field today.
   **Recommend: 512 KiB.**
2. **One budget for every endpoint.** One number is simpler and enough while every body is
   short text. Bug reports (WT-06) may carry evidence and can set their own budget in their
   work-spec. **Recommend: one global budget now.**
3. **API requests skip the page proxy** (section 3), which removes Next.js's 10 MB buffering
   of each API request body. Nothing else changes for them. The alternative,
   `experimental.proxyClientMaxBodySize`, is experimental and truncates instead of refusing.
   **Recommend: exclude `api/` from the matcher.**
4. **Only JSON bodies.** No endpoint takes another body type in v1 (no file uploads), so the
   limit lives in `readJson`. A future work-spec that adds another body type must bound it
   too. **Recommend: as proposed.**
5. **The older branch** `claude/wi-044-request-body-limit` (2026-11-15) implemented a first
   version on code that has since changed; it did not cover the proxy buffering. This spec
   replaces it. **Recommend: the branch can be deleted.**
