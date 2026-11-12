# WS-005 — Health endpoint: the first vertical slice

- Status: Done (approved by the owner on 2026-11-12)
- Work-item: [WI-005](../work-items/WI-005-health-endpoint.md)
- Canonical docs: `AGENTS.md` sections 3 and 6

## Approach

Three small pieces, one per layer:

1. **Schema** (`src/lib/schemas/health.ts`): `healthResponseSchema`, a Zod object with
   `status: "ok" | "degraded"` and `database: "up" | "down"`, plus the inferred
   `HealthResponse` type. WI-006 will generate the OpenAPI document from schemas like
   this one.
2. **Service** (`src/server/services/health.ts`): `checkHealth(db)` runs `select 1` with a
   2-second timeout and returns a `HealthResponse`. It takes the database as a parameter,
   catches every failure, and returns `degraded`/`down` instead of throwing. It knows
   nothing about HTTP.
3. **Route handler** (`src/app/api/v1/health/route.ts`): `GET` calls
   `checkHealth(getDb())`, maps `ok` to `200` and `degraded` to `503`, and sets
   `Cache-Control: no-store`. No logic beyond that mapping.

The route must be dynamic so Next.js does not evaluate it at build time; the mechanism is
taken from the route handler docs shipped with the installed Next.js version.

A failed check is logged server-side with `console.error` (error class and message only);
none of it reaches the response.

### Not in this item

A shared error response format for the API (for example RFC 9457 problem details),
pagination and versioning rules. The health endpoint needs none of them. They are needed
before the first real resource endpoint, so I propose a short canonical doc "API
conventions" at the start of WT-02.

## Files

| Path                                              | Change                 |
| ------------------------------------------------- | ---------------------- |
| `src/lib/schemas/health.ts`                       | create                 |
| `src/lib/schemas/health.test.ts`                  | create (written first) |
| `src/server/services/health.ts`                   | create                 |
| `src/server/services/health.integration.test.ts`  | create (written first) |
| `src/app/api/v1/health/route.ts`                  | create                 |
| `src/app/api/v1/health/route.integration.test.ts` | create (written first) |
| `src/app/api/v1/health/route.test.ts`             | create (written first) |

No new dependencies.

## Data model changes

None.

## API contract

`GET /api/v1/health` — public, no authentication, no parameters.

| Status | Body                                           | When                         |
| ------ | ---------------------------------------------- | ---------------------------- |
| `200`  | `{ "status": "ok", "database": "up" }`         | database answered            |
| `503`  | `{ "status": "degraded", "database": "down" }` | database failed or timed out |

Headers: `Content-Type: application/json`, `Cache-Control: no-store`.

## Test plan (written first, in this order)

| #   | Level        | Test                                                                                                                                      | Covers criterion        |
| --- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 1   | unit         | schema accepts the two valid bodies and rejects unknown values and extra fields                                                           | schema-defined body     |
| 2   | integration  | `checkHealth(getDb())` returns `ok`/`up` against the real test database                                                                   | 200 path, service       |
| 3   | integration  | `checkHealth` with a client pointed at an unreachable port returns `degraded`/`down` and does not throw                                   | 503 path, service       |
| 4   | integration  | `checkHealth` with a query that outlasts the timeout returns `degraded`/`down` within the time limit                                      | never hangs             |
| 5   | integration  | calling the route's `GET` returns `200`, a body that parses with the schema, and `no-store`                                               | 200 path, handler       |
| 6   | unit         | with the service stubbed to `degraded`, `GET` returns `503` and the degraded body                                                         | status mapping          |
| 7   | unit         | the degraded response contains only the two fields (no error text)                                                                        | nothing leaks           |
| 8   | manual, once | `pnpm build` output lists `/api/v1/health` as dynamic; `curl` against `pnpm start` returns `200`; stop the database, `curl` returns `503` | per request, end to end |
| 9   | gate         | `typecheck`, `lint`, `format:check`, `test`, `build`                                                                                      | gate                    |

An automated browser-level check of this endpoint arrives with Playwright in WI-007.

## Resolved questions

Decided with the owner on 2026-11-12:

1. `AGENTS.md` hard rule 6 now allows endpoints that a work-spec explicitly declares
   public. `GET /api/v1/health` is declared public by this spec.
2. A canonical doc "API conventions" (error format, pagination, versioning) will be
   written at the start of WT-02.

## Deviations from the approved spec

1. **The timeout test is a unit test, not an integration test** (plan row 4). It uses a
   stub whose query never answers, which is deterministic; making a real PostgreSQL query
   outlast a timeout would need `pg_sleep` and slow the suite. The unreachable-database
   case (row 3) remains a real integration test.
2. **One extra test file**, `src/server/services/health.test.ts`, holds that test and two
   more unit cases for the service.
3. `checkHealth` accepts an optional `{ timeoutMs, logError }` argument so tests can use a
   short timeout and capture the log line instead of printing it.

## Implementation record

- Red: five new test files failed on missing modules.
- Green: 42 tests pass (32 unit, 10 integration).
- `pnpm build` lists `/api/v1/health` as dynamic (`ƒ`).
- Manual, against `pnpm start`: database up gives `200`
  `{"status":"ok","database":"up"}` with `Cache-Control: no-store`; database stopped gives
  `503` `{"status":"degraded","database":"down"}` in under 10 ms; after restarting the
  database the endpoint returns `200` again without restarting the app.
- `typecheck`, `lint`, `format:check`, `test`, `build` pass.

## Risks and open questions

1. **Hard rule 6 says every API endpoint enforces authentication.** A health check has to
   be callable without credentials (Docker health checks, load balancers, CI), and the
   OpenAPI document in WI-006 has the same need. Proposed rewording of rule 6:
   "Every API endpoint enforces authentication and an explicit permission check, except
   endpoints that a work-spec explicitly declares public. Public endpoints must not expose
   data or internal detail." **Owner: approve this change to `AGENTS.md`?**
2. **Timeout of 2 seconds** is a judgement call: long enough for a busy database, short
   enough for a health probe. Adjustable later.
3. **"API conventions" canonical doc before WT-02**, as described above. **Owner: agree?**
