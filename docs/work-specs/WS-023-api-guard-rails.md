# WS-023 — API guard rails: declared authentication and enforced checks

- Status: Done (approved by the owner on 2026-11-13)
- Work-item: [WI-023](../work-items/WI-023-api-guard-rails.md)
- Canonical docs: [0004](../canonical/0004-api-conventions.md) section 7; `AGENTS.md`
  hard rules 6 and 9

## Approach

### 1. Security scheme in the OpenAPI document

`buildOpenApiDocument` (`src/lib/openapi/document.ts`) adds

```jsonc
"components": { "securitySchemes": {
  "sessionCookie": { "type": "apiKey", "in": "cookie", "name": "opanel.session_token",
    "description": "Set by POST /api/v1/auth/sign-in. Over https the cookie is named __Secure-opanel.session_token." }
} }
```

and gives every contract with `public: false` the requirement
`security: [{ "sessionCookie": [] }]`. The cookie name is read from
`SESSION_COOKIE_NAMES` in `src/lib/session-cookie.ts`, not typed again. OpenAPI can name
only one cookie per scheme, so the plain name is the declared one and the `__Secure-`
variant is in the description.

The bearer-token scheme is not declared yet: tokens do not exist until WT-05, and the
document must not describe what the server rejects.

### 2. A structural test for the three checks

`src/lib/openapi/routes.test.ts` already reads every `route.ts` under `src/app/api` and
matches exported methods to contracts. It gains a second block that, for each exported
method, looks at the source of that export and asserts:

| Condition                                        | The handler must call |
| ------------------------------------------------ | --------------------- |
| its contract has `public: false`                 | `authenticate(`       |
| same, and not on the authentication-only list    | `requirePermission(`  |
| the method is `POST`, `PUT`, `PATCH` or `DELETE` | `assertSameOrigin(`   |

The authentication-only list is a constant in the test with two entries,
`GET /api/v1/me` and `POST /api/v1/auth/sign-out`, each with a comment pointing at
WS-015. A further test asserts the list has exactly those two, so adding to it is a
visible, reviewed change.

Handlers are written as `export const METHOD = route(async (...) => { ... })`. The test
takes the text from that export to the next top-level `export` (or the end of the file).
This is the same level of analysis the file already does for contracts: text, not types.

The catch-all `[...path]/route.ts` stays exempt: it has no contract and changes nothing.

### Alternative considered

Moving the checks into the wrapper, for example
`route({ permission: "accounts:manage" }, handler)`, so that a handler cannot exist
without declaring them. It is the stronger design, but it changes every route handler and
the wrapper's signature for nine endpoints that are already correct. I propose the test
now and the wrapper change as a follow-up to weigh at the start of WT-03, when the number
of endpoints starts to grow quickly. See question 1.

## Files

| Path                               | Change                                               |
| ---------------------------------- | ---------------------------------------------------- |
| `src/lib/openapi/document.ts`      | modify: security scheme and per-operation `security` |
| `src/lib/openapi/document.test.ts` | modify (new cases written first)                     |
| `src/lib/openapi/routes.test.ts`   | modify: the three structural checks                  |
| `docs/api/openapi.json`            | regenerate                                           |
| `docs/README.md`                   | modify: status (the follow-up was already replaced)  |

No new dependencies. No application code outside the OpenAPI generator changes.

## Data model changes

None.

## API contract

No endpoint changes. The OpenAPI document gains `components.securitySchemes.sessionCookie`
and a `security` entry on each non-public operation. This is additive documentation of
existing behaviour, not a breaking change (doc 0004 section 8).

## Test plan (written first, in this order)

| #   | Level | Test                                                                                                                                                                 | Covers criterion            |
| --- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| 1   | unit  | the document declares `sessionCookie` as an `apiKey` in `cookie` whose name equals the first entry of `SESSION_COOKIE_NAMES`                                         | scheme declared             |
| 2   | unit  | a non-public test contract gets `security: [{ sessionCookie: [] }]`; a public one keeps `security: []`                                                               | per operation               |
| 3   | unit  | every non-public operation of the real document requires `sessionCookie`; the document is still valid OpenAPI 3.1                                                    | per operation               |
| 4   | unit  | the committed `docs/api/openapi.json` matches (existing staleness test, red until regenerated)                                                                       | regenerated                 |
| 5   | unit  | the source-slicing helper, on a small sample source with two exports, returns each export's own text                                                                 | structural test itself      |
| 6   | unit  | the checker, on sample sources: reports a missing `authenticate`, a missing `requirePermission`, and a missing `assertSameOrigin`, each naming the file and the call | fails when missing, message |
| 7   | unit  | the checker passes a sample public `POST` that has only `assertSameOrigin`, and a sample authentication-only `GET` without a permission check                        | exceptions                  |
| 8   | unit  | every real route file passes the checker                                                                                                                             | current code is correct     |
| 9   | unit  | the authentication-only list is exactly `GET /api/v1/me` and `POST /api/v1/auth/sign-out`                                                                            | explicit list               |
| 10  | gate  | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`                                                                                                              | gate                        |

Tests 5 to 7 run the checker on sample text so that it is itself tested: a checker that
always passes would otherwise look green. The checker is a small pure function in a new
`src/lib/openapi/route-checks.ts`, used only by the test.

## Deviations from the approved spec

1. **The checker's own tests are in a new file**, `src/lib/openapi/route-checks.test.ts`,
   next to the checker, instead of inside `routes.test.ts`. `routes.test.ts` holds only
   the checks against the real route files.
2. **The checker ignores comments.** A call that is only mentioned in a comment does not
   count; a test covers it.
3. **One extra test** asserts that the checker looked at every documented operation, so a
   handler written in a form the checker does not recognise cannot be skipped silently.
4. **Every operation now carries `security`** in the generated document, also the public
   ones (`[]`, as before).

## Implementation record

- Red: three document tests failed on the missing scheme and requirement; the two
  route-check test files failed on the missing module.
- Green: 398 tests pass (up from 381). Playwright: 22 pass.
- Checked by hand that the test bites: with `requirePermission` and `assertSameOrigin`
  removed from `v1/accounts/[accountId]/route.ts`, it failed with
  "PATCH does not call assertSameOrigin(): ..." and
  "PATCH does not call requirePermission(): ...". The file was restored.
- `docs/api/openapi.json` regenerated: `components.securitySchemes.sessionCookie` and a
  `security` requirement on the six non-public operations. No endpoint changed.
- `typecheck`, `lint`, `format:check`, `test`, `test:e2e` pass locally, against PostgreSQL
  16 (no Docker in the sandbox used). CI runs them on the PostgreSQL of `compose.yaml`.

## Resolved questions

The owner approved this spec and agreed with its questions on 2026-11-13:

1. **The test now.** Whether the checks move into the `route()` wrapper is decided at the
   start of WT-03 (recorded as a follow-up in `docs/README.md`).
2. **A text check catches forgetting, not misplacement.** Accepted: the per-endpoint
   integration tests remain the proof of behaviour.
3. **`route-checks.ts` lives in `src/lib/openapi/`** as test support with its own tests.
