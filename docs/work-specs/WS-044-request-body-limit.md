# WS-044 — Request body size limit

- Status: Done
- Work-item: [WI-044](../work-items/WI-044-request-body-limit.md)
- Canonical docs: [0004](../canonical/0004-api-conventions.md) sections 3 and 4; audit of
  2026-11-14, finding A-03

## Approach

`readJson` (`src/server/http/route.ts`) calls `request.json()`, which buffers the whole body
before Zod sees it. The `max` lengths of the schemas bound the validated fields, not the
memory used to receive the document. The route wrapper also runs on public endpoints.

### The budget

`MAX_JSON_BODY_BYTES = 512 * 1024` (524 288 bytes), one constant for every JSON endpoint.
The largest field in the schemas is 50 000 characters (the task description). In JSON that
is at most 6 bytes per character (a control character becomes `\u00XX`), so 300 000 bytes
for that field in the worst case, and a few kilobytes for the rest. 512 KiB covers every
valid request with room, and is small enough to cap memory per request. A new field larger
than this must change the constant in its own work-spec.

### `readJson`, in this order

1. Not `application/json`: `415`, as today.
2. `Content-Length`, if it is a plain non-negative integer larger than the budget: `413` at
   once, without reading. A missing or malformed header is ignored; it is never trusted to
   mean the body is small.
3. Read `request.body` with a reader, adding up the bytes of every chunk. When the total
   passes the budget, cancel the reader and throw `413`. Nothing more is buffered. (This is
   what makes a wrong `Content-Length` or chunked encoding harmless.)
4. A body that cannot be read (the client disconnects half way) is `400`, not `500`.
5. Decode as UTF-8 and parse. Malformed JSON is `400` as today. The text goes to the same
   `validate` step.

The error is `payloadTooLarge()` in `errors.ts`: status `413`, title `Content Too Large`,
code `payload_too_large`, detail `The request body is too large.` The detail does not state
the limit's value: it is documented, and does not need to be repeated.

`413` is thrown before the handler's service runs, so a refused request writes nothing: no
audit entry, no limiter count.

### Contracts and documentation

Every operation that takes a JSON body already documents `415`; each gets `413` next to it,
through one shared constant (`TOO_LARGE`, beside the per-file `NOT_JSON` constants it
resembles). A unit test asserts the two always go together, so a new endpoint cannot forget
one. Canonical doc 0004 gets `413` / `payload_too_large` in both tables. `pnpm
openapi:generate` is run and its diff committed.

### Reverse proxy

The application cannot know the proxy's limit. The production-deployment follow-up in
`docs/README.md` gets one more line: the proxy must allow at least this budget and should
refuse larger bodies itself.

## Files

| Path                                                                    | Change                                        |
| ----------------------------------------------------------------------- | --------------------------------------------- |
| `src/server/http/route.ts`                                              | modify: bounded `readJson`                    |
| `src/server/http/errors.ts`, `errors.test.ts`                           | modify: `payloadTooLarge`                     |
| `src/lib/schemas/problem.ts`                                            | modify: `payload_too_large` code, `TOO_LARGE` |
| `src/lib/schemas/{accounts,auth,columns,epics,projects,tasks,teams}.ts` | modify: document `413` beside every `415`     |
| `src/server/http/route.test.ts`                                         | modify (new cases written first)              |
| `src/lib/openapi/routes.test.ts`                                        | modify (the `413` with `415` rule)            |
| `tests/e2e/body-limit.spec.ts`                                          | create (against the running server)           |
| `docs/canonical/0004-api-conventions.md`                                | modify: status and code                       |
| OpenAPI output of `pnpm openapi:generate`                               | regenerate                                    |
| `docs/README.md`, WI-044, WS-044                                        | statuses; the proxy line                      |

No new dependencies.

## Data model changes

None.

## API contract

New response on every operation that takes a JSON body: `413`, problem body, code
`payload_too_large`. No existing response changes, and a request within the budget behaves
exactly as before. Strictly this adds a response to existing operations, not a breaking
change.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                                         | Covers criterion          |
| --- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| 1   | unit        | a body one byte under, and exactly at, the budget is parsed and validated as before                                                                                                          | at the limit              |
| 2   | unit        | one byte over the budget with a correct `Content-Length`: `413`, and the body stream was not read                                                                                            | early refusal             |
| 3   | unit        | over the budget with no `Content-Length` (a stream): `413`, and the stream was cancelled after the budget plus at most one chunk                                                             | counted, not buffered     |
| 4   | unit        | `Content-Length` declares 10, the stream sends more than the budget: `413`                                                                                                                   | wrong header              |
| 5   | unit        | `Content-Length` of `abc` or `-1` is ignored: a small body passes, a large one is `413`                                                                                                      | malformed header          |
| 6   | unit        | multibyte: 200 000 three-byte characters (600 000 bytes, yet fewer than 524 288 characters) is `413`                                                                                         | bytes, not characters     |
| 7   | unit        | malformed JSON within the budget is `400` with the same message as today; a stream that errors half way is `400`; the content-type check (`415`) still comes first                           | no regression             |
| 8   | unit        | a UTF-8 byte order mark and a valid multibyte body parse the same as with `request.json()`                                                                                                   | same parsing              |
| 9   | integration | `POST /api/v1/sign-in` (public) with an oversized body: `413`, no audit entry and no limiter row written                                                                                     | refused before service    |
| 10  | unit        | every contract that documents `415` also documents `413`, and the reverse                                                                                                                    | contracts                 |
| 11  | unit        | the generated OpenAPI document contains `413` with the problem schema; the OpenAPI validation test passes                                                                                    | OpenAPI                   |
| 12  | e2e         | against the running app: a body of the budget plus 1 byte posted to `/api/v1/sign-in` gets `413` with `application/problem+json` and a request id; a small body still gets the normal answer | real transport            |
| 13  | e2e         | the same with chunked transfer encoding and no `Content-Length`, sent with a raw Node `http` request                                                                                         | real transport, no header |
| 14  | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; `pnpm openapi:generate` leaves no diff                                                                                              | gate                      |

Test 6 states the byte count in the test itself, so a change from bytes to characters would
fail it. Tests 12 and 13 are there because a constructed `Request` does not exercise the
framework's or a proxy's handling of the transport.

## Risks and open questions

1. **The value.** 512 KiB is derived above from the current largest field. **Owner: accept
   512 KiB, or choose another?** Bug reports (WT-06) may carry evidence and will need their
   own, larger budget; they can set it in their own work-spec.
2. **A global budget over a per-endpoint one.** One number is simpler and enough while every
   body is small text. **Owner: is a per-endpoint budget wanted now?** The recommendation is
   to wait until an endpoint needs it.
3. **Only JSON bodies.** No endpoint takes another body type in v1 (no file uploads), so
   the limit lives in `readJson`. A future work-spec that adds one must bound it too.

## Deviations from the approved spec

1. **The shared `413` response is `PAYLOAD_TOO_LARGE` in `src/lib/openapi/responses.ts`**, next to
   `versionConflictResponse`, not a `TOO_LARGE` in `problem.ts`: it is a response contract, and
   that file already holds the other one. Seven schema files import it.
2. **Test 2 allows one chunk pulled** from a refused request's stream. A `ReadableStream` queues
   one chunk as soon as it is made; what the test shows is that nothing is read after that.
3. **For the branches that join later.** The `413`-with-`415` test checks every contract, so when
   the comments contract (WI-034) and any later one with a body meet this branch they must add
   `413: PAYLOAD_TOO_LARGE` to pass: the test is the reminder. The end-to-end spec here uses
   Playwright's own `test`, because `tests/e2e/base.ts` lives on the WI-041 branch; on
   integration it takes `test` from there like every other spec.
4. The proxy line of the production follow-up (it must allow 512 KiB and should refuse more
   itself) is already in `docs/README.md` from the audit branch.

## Implementation record

- Red: committed first on this branch; the errors, route, contract and problem-code tests failed
  on the missing `payloadTooLarge`, `MAX_JSON_BODY_BYTES` and the undocumented `413`.
- Green: 705 Vitest tests and 31 Playwright tests (three new in `body-limit.spec.ts`) pass, twice
  in a row. Typecheck, lint and format pass; `pnpm openapi:generate` adds the `413` to the 20
  operations with a body and the generated file is committed; `pnpm db:generate` leaves no diff.
- Against the running server: a body of `512 KiB + 1` byte is `413` with a problem body and a
  request id; one of exactly 512 KiB is read; a chunked body with no `Content-Length` is
  counted and refused as well.
- Locally the database was PostgreSQL 16 (no Docker in the sandbox); CI runs the
  PostgreSQL 18 of `compose.yaml`.
