# WS-025 — `route()` declares authentication and permission

- Status: Approved (approved by the owner on 2026-11-13, with question 1 as proposed)
- Work-item: [WI-025](../work-items/WI-025-route-declares-access.md)
- Canonical docs: [0004](../canonical/0004-api-conventions.md) sections 3, 7; `AGENTS.md`
  hard rules 6 and 9; [WT-03](../work-tracks/WT-03-board-core.md) decision 1;
  [WS-023](WS-023-api-guard-rails.md) question 1

## Approach

### 1. Access is part of the contract

`EndpointContract` (`src/lib/openapi/contract.ts`) replaces `public: boolean` with:

```ts
export type Access =
  | { kind: "public" } // a work-spec declares it public (AGENTS.md rule 6)
  | { kind: "authenticated" } // acts on the caller's own session or account only
  | { kind: "permission"; permission: Permission }; // one name from the catalogue

export interface EndpointContract {
  // ...as today, without `public`
  access: Access;
}
```

The contract is already the single description of an operation (method, path, request
schemas, responses). Putting the access there means the OpenAPI document, the wrapper and
the guard-rail test all read the same declaration, and none of them can drift from the
others. The fourteen existing contracts are converted one to one: the five `public: true`
become `{ kind: "public" }`, the four authentication-only operations
`{ kind: "authenticated" }`, and the five account-management operations
`{ kind: "permission", permission: "accounts:manage" }`.

### 2. The wrapper enforces it

`route()` (`src/server/http/route.ts`) takes the contract first:

```ts
export const POST = route(inviteAccountContract, async (request, context, auth) => {
  const body = await readJson(request, inviteRequestSchema);
  return json(await inviteAccount(auth.actor, body), 201);
});
```

Before the handler runs, in this order, inside the existing error handling (so every
refusal is a problem body with a request id):

1. **Origin.** For `POST`, `PUT`, `PATCH` and `DELETE`, `assertSameOrigin(request,
APP_URL)`, whatever the access kind. Today every state-changing handler, public or not,
   makes this call first; the order is kept, so a cross-site request is a `403` before
   any database work.
2. **Authentication.** Unless the access is `public`, `authenticate(request)`; `401` on
   failure.
3. **Permission.** If the access is `permission`, `requirePermission(auth.actor,
permission)`; `403` on failure.

The handler's third argument is the `Authenticated` value (`actor`, `account`,
`sessionId`, `headers`) for non-public operations, and `undefined` for public ones. Its
type follows the contract: `route` is generic over the contract's access kind, so
`auth.actor` needs no non-null assertion in a non-public handler, and a public handler
cannot use it. The contracts keep `satisfies EndpointContract`, which preserves the literal
`kind`.

**Cookies.** After the handler returns, the wrapper appends the `Set-Cookie` headers of
`auth.headers` to the response **only if the response sets no cookie of its own**. Today
every authenticated handler passes `headers` to `json()` or `noContent()` by hand except
sign-out, whose response clears the cookie and must not be followed by a refreshed one.
The rule gives the same result for every handler that exists today and removes the hand-written argument.
`json(body, status, cookies)` and `noContent(cookies)` keep their optional `cookies`
argument for handlers that produce their own (sign-in, setup, accept link, sign-out).

`APP_URL` is read with `getEnv()` when a request arrives, not when the module loads, so
importing a route file needs no environment (the guard-rail test imports them, section 4).
`RouteOptions` gains `appUrl?: string` for the unit tests, next to the existing
`logError`.

The returned function carries the contract as a read-only property, `handler.contract`,
for the guard-rail test.

**The catch-all** `src/app/api/[...path]/route.ts` has no contract. It uses a second,
narrower export, `unknownPathRoute(handler)`, which gives only request id, headers and
error conversion. Only the catch-all may use it (checked in section 4).

### 3. Handlers become thinner

Every handler under `src/app/api/v1` drops its own `assertSameOrigin`, `authenticate` and
`requirePermission` calls and the `headers` it passed along, and reads `auth` instead.
Nothing else in a handler changes. The `// Authenticated, and needs ...` comments above
each handler go: the contract says it.

**Health and the OpenAPI document** do not use `route()` today. They move to it, so that
every operation is built the same way and the guard-rail test has no exception:

- `GET /api/v1/health` keeps its body and its `503`; it gains `X-Request-Id`, which doc
  0004 section 2 already requires on every response.
- `GET /api/v1/openapi.json` changes from `force-static` to `force-dynamic` and gains
  `Cache-Control: no-store` and `X-Request-Id`. The document is built once per process and
  kept in a module variable, so the cost is unchanged. See question 1.

### 4. The guard-rail test checks declarations, not text

`src/lib/openapi/routes.test.ts` no longer searches handler text. It imports each route
file under `src/app/api` and, for every exported HTTP method:

| Check                                                                                                     |
| --------------------------------------------------------------------------------------------------------- |
| it is a function built by `route()`, so it has a `contract` property                                      |
| that contract's method and path are this export's method and this file's path                             |
| that contract is in `contracts` (so it is in the OpenAPI document), and every contract has such a handler |
| only the catch-all is built by `unknownPathRoute`                                                         |

Because the wrapper enforces whatever the contract declares, a handler that forgets a
check can no longer exist; what is left to verify is that each handler is wired to the
right contract. The authentication-only list stays a reviewed constant: a test asserts
that the operations whose access is `authenticated` are exactly the four of WS-015 and
WS-021. A further test asserts that every contract with `public` access is one of the five
declared public by WS-005, WS-006, WS-015, WS-016 and WS-019, so making an operation public
is also a visible change.

`src/lib/openapi/route-checks.ts` and its test are deleted: they existed only for the text
search. The `exportedHandlers` text helper is no longer needed either.

### 5. The OpenAPI document names the permission

`buildOpenApiDocument` derives `security` from `access.kind !== "public"` (unchanged
output) and, for `permission` access, adds the vendor extension
`"x-opanel-permission": "accounts:manage"` to the operation and appends
"Requires the `accounts:manage` permission." to its description. Agent authors (WT-05)
need to know which scope an operation needs. This is additive (doc 0004 section 8). The
hand-written "Needs the `accounts:manage` permission (Admin)." sentence in
`src/lib/schemas/accounts.ts` is removed so it is not said twice.

### Alternative considered

Letting the wrapper also validate `params`, `query` and `body` against the contract's
request schemas, so handlers receive parsed input. It would remove more repetition, but it
changes how every handler reads its input and how `readJson` reports `415`. It is not part
of WT-03 decision 1 and is left out; it can be proposed on its own if the repetition
starts to hurt.

## Files

| Path                                                      | Change                                                          |
| --------------------------------------------------------- | --------------------------------------------------------------- |
| `src/lib/openapi/contract.ts`                             | modify: `Access`, `access` replaces `public`                    |
| `src/lib/schemas/{health,openapi,auth,accounts}.ts`       | modify: each contract declares `access`                         |
| `src/lib/openapi/document.ts`                             | modify: `security` from `access`; `x-opanel-permission`         |
| `src/lib/openapi/document.test.ts`                        | modify (new cases written first)                                |
| `src/server/http/route.ts`                                | modify: `route(contract, handler)`, `unknownPathRoute`, cookies |
| `src/server/http/route.test.ts`                           | modify: new signature; public-access cases                      |
| `src/server/http/route-access.integration.test.ts`        | create: origin, `401`, `403`, `auth`, cookies, on a real DB     |
| `src/app/api/[...path]/route.ts`                          | modify: `unknownPathRoute`                                      |
| `src/app/api/v1/**/route.ts` (12 files)                   | modify: `route(contract, ...)`, checks removed                  |
| `src/lib/openapi/routes.test.ts`                          | modify: declaration checks replace the text search              |
| `src/lib/openapi/route-checks.ts`, `route-checks.test.ts` | delete                                                          |
| `docs/api/openapi.json`                                   | regenerate                                                      |
| `docs/canonical/0004-api-conventions.md`                  | modify: section 7 says where access is declared                 |
| `docs/work-tracks/WT-02-...md`                            | modify: the implementer note on the guard-rail test             |
| `docs/README.md`, WI-025, WS-025, WT-03                   | modify: statuses                                                |

No new dependency.

## Data model changes

None.

## API contract

No endpoint changes its path, input, output or status codes. Observable differences, all
additive or required by doc 0004:

- Every operation in the OpenAPI document with `permission` access gains
  `x-opanel-permission` and a sentence in its description.
- `GET /api/v1/health` gains `X-Request-Id`.
- `GET /api/v1/openapi.json` gains `Cache-Control: no-store` and `X-Request-Id`, and is
  rendered per request (from a cached document) instead of at build time.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                      | Covers criterion    |
| --- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| 1   | unit        | a public contract's `POST` from another origin, or with no `Origin`, is `403` and the handler is not called; same-origin reaches it       | origin              |
| 2   | unit        | a public contract's handler receives `undefined` as `auth`; `GET` needs no `Origin`                                                       | public              |
| 3   | unit        | the wrapped function exposes its contract; `unknownPathRoute` exposes none                                                                | guard-rail input    |
| 4   | integration | non-public `GET` without a cookie is `401` problem body; handler not called                                                               | `401`               |
| 5   | integration | `permission` access: a Viewer is `403`, an Admin reaches the handler with `auth.actor.role === "admin"`                                   | `403`, auth handed  |
| 6   | integration | cross-origin `POST` with a valid cookie is `403` before authentication (no session is extended: no `Set-Cookie`)                          | order               |
| 7   | integration | `authenticated` access lets a Viewer through                                                                                              | authentication only |
| 8   | integration | a response with no cookie of its own gets authentication's `Set-Cookie`; one that sets a cookie keeps only its own                        | cookies             |
| 9   | unit        | document: `security` from `access`; `x-opanel-permission` and description sentence on permission operations only; still valid OpenAPI     | OpenAPI             |
| 10  | unit        | routes: every export is wired to the contract of its own method and path; every contract has a handler                                    | guard rail          |
| 11  | unit        | routes: `authenticated` operations are exactly the four; `public` operations exactly the five; only the catch-all uses `unknownPathRoute` | reviewed lists      |
| 12  | integration | existing route tests of all twelve route files, unchanged, plus `X-Request-Id` on health and `no-store` on the OpenAPI document           | no behaviour change |
| 13  | e2e         | existing Playwright suite, unchanged                                                                                                      | no behaviour change |

Tests 1 to 3 and 9 to 11 are written against the new signatures and fail to compile or
fail first. Test 10 is checked to fail by wiring one handler to a wrong contract locally.

## Risks and open questions

1. **The OpenAPI document becomes dynamic.** Doc 0004 says every API response carries
   `Cache-Control: no-store` and `X-Request-Id`; the static document carries neither, and
   neither does health. This spec brings both in line (hard rule 11: raised, not silently
   picked). The alternative is to keep `openapi.json` static and record it in doc 0004 as
   an exception. Proposed: make it dynamic.
2. **Importing route files in a unit test.** The guard-rail test imports every route
   module. This works only if no module reads the environment or opens the database at
   import time; today they do not (`getEnv()`, `getDb()` and `getAuth()` are lazy), and
   section 2 keeps `route()` lazy too. If a future module breaks this, the test fails
   loudly at import rather than passing silently.
3. **Large diff with no behaviour change.** Twelve route files change at once. The
   existing integration tests of every endpoint are the safety net and must pass without
   edits other than those listed in test 12.
