# WS-006 — OpenAPI document generated from Zod

- Status: Proposed (must be `Approved` by the owner before any code is written)
- Work-item: [WI-006](../work-items/WI-006-openapi.md)
- Canonical docs: `AGENTS.md` sections 2, 3 and hard rule 9; [0001](../canonical/0001-ai-qa-agents-and-triage.md)

## Approach

### Library: `zod-openapi`

`zod-openapi` 6 builds an OpenAPI 3.1 document from plain Zod 4 schemas using Zod's own
`.meta()` for titles, descriptions and component names. The alternative,
`@asteasolutions/zod-to-openapi`, works by patching Zod with an extra `.openapi()` method;
`zod-openapi` needs no patching, so schemas stay ordinary Zod.

### One contract definition per endpoint

Each endpoint is described once, in a small "contract" object that sits beside its Zod
schema in `src/lib/schemas`:

```ts
// src/lib/schemas/health.ts (addition)
export const healthContract = {
  method: "get",
  path: "/api/v1/health",
  summary: "Service health",
  public: true,
  responses: {
    200: {
      description: "The service and its database are available.",
      schema: healthResponseSchema,
    },
    503: { description: "The database is unavailable.", schema: healthResponseSchema },
  },
} satisfies EndpointContract;
```

`src/lib/openapi/contracts.ts` lists all contracts; `src/lib/openapi/document.ts` turns
that list into the document with `zod-openapi`. Adding an endpoint later means adding its
contract to the list, nothing else.

### Three guards against drift

1. **Routes and document must match.** A test scans `src/app/api/v1/**/route.ts`, reads
   which HTTP methods each file exports, and compares that set with the contracts list.
   A route without a contract, or a contract without a route, fails the test.
2. **The committed file must be current.** `docs/api/openapi.json` is written by
   `pnpm openapi:generate`. A test regenerates the document and fails if the file
   differs, with a message saying which command to run.
3. **The document must be valid.** A test validates it against the official OpenAPI 3.1
   schema.

### Serving

`GET /api/v1/openapi.json` returns the generated document. It is declared public by this
spec (hard rule 6): the project is open source and the document contains only the API
shape. Unlike the health endpoint it is static, since its content is fixed at build time.

The endpoint describes itself in the document too, so guard 1 has no exceptions.

### Document metadata

`info.title` "Opanel API", `info.version` taken from `package.json`, license MIT, one
server entry `/`. Security schemes (session cookie, agent bearer token) are added with the
work-tracks that implement them.

## Versions

| Package                               | Version | Kind       |
| ------------------------------------- | ------- | ---------- |
| `zod-openapi`                         | 6.0.2   | dependency |
| `@seriousme/openapi-schema-validator` | 2.11.0  | dev        |

## Files

| Path                                        | Change                                                           |
| ------------------------------------------- | ---------------------------------------------------------------- |
| `package.json`, lockfile                    | modify: dependencies, script `openapi:generate`                  |
| `src/lib/openapi/contract.ts`               | create: `EndpointContract` type                                  |
| `src/lib/openapi/contracts.ts`              | create: the list of all contracts                                |
| `src/lib/openapi/document.ts`               | create: `buildOpenApiDocument()`                                 |
| `src/lib/openapi/document.test.ts`          | create (written first): content, validity, committed file        |
| `src/lib/openapi/routes.test.ts`            | create (written first): routes and contracts match               |
| `src/lib/schemas/health.ts`                 | modify: schema metadata, `healthContract`                        |
| `src/lib/schemas/openapi.ts`                | create: `openApiContract` (the document endpoint itself)         |
| `src/app/api/v1/openapi.json/route.ts`      | create                                                           |
| `src/app/api/v1/openapi.json/route.test.ts` | create (written first)                                           |
| `scripts/generate-openapi.ts`               | create: writes `docs/api/openapi.json`                           |
| `docs/api/openapi.json`                     | create (generated, committed)                                    |
| `.prettierignore`                           | modify only if Prettier and the generator disagree on formatting |

## Data model changes

None.

## API contract

`GET /api/v1/openapi.json` — public, no parameters. `200` with the OpenAPI 3.1 document,
`Content-Type: application/json`.

## Test plan (written first, in this order)

| #   | Level        | Test                                                                                                                                             | Covers criterion       |
| --- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| 1   | unit         | the document is OpenAPI `3.1.x` with the expected `info`                                                                                         | document exists        |
| 2   | unit         | it contains `GET /api/v1/health` with `200` and `503` responses referencing the health schema, whose properties and enums equal the Zod schema's | generated from Zod     |
| 3   | unit         | the document validates against the official OpenAPI 3.1 schema                                                                                   | valid                  |
| 4   | unit         | every `route.ts` method under `src/app/api/v1` has a contract and every contract has a route                                                     | no drift               |
| 5   | unit         | `docs/api/openapi.json` equals the freshly generated document                                                                                    | committed file current |
| 6   | unit         | the route's `GET` returns `200`, JSON, and a body equal to `buildOpenApiDocument()`                                                              | served                 |
| 7   | manual, once | add a throwaway route without a contract: test 4 fails; change the health schema: test 5 fails; revert both                                      | guards bite            |
| 8   | manual, once | `curl /api/v1/openapi.json` against `pnpm start` returns the document                                                                            | end to end             |
| 9   | gate         | `typecheck`, `lint`, `format:check`, `test`, `build`                                                                                             | gate                   |

## Risks and open questions

1. **Committed `docs/api/openapi.json`.** It makes every API change visible in review and
   gives agent authors a file to point tools at without running the app. The cost is one
   extra command when the API changes (the failing test names it). **Owner: keep the
   committed file, or serve the document only?**
2. **No documentation UI in this item.** A browsable page (for example Scalar) is a
   separate dependency and a design decision. Proposed: add it later, when there are real
   endpoints worth browsing. **Owner: agree?**
3. Reading exported HTTP methods from route files uses a simple pattern match on
   `export async function GET` / `export function GET` / `export const GET`. If that
   proves fragile, the fallback is importing each route module in the test.
