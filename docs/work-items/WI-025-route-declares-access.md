# WI-025 — `route()` declares authentication and permission

- Status: Done
- Work-track: [WT-03](../work-tracks/WT-03-board-core.md) (design decision 1)
- Depends on: none
- Work-spec: [WS-025](../work-specs/WS-025-route-declares-access.md)

## Outcome

Every API operation declares, in its contract, who may call it: anyone (public), any
signed-in account (authentication only) or an account holding one named permission. The
`route()` wrapper enforces that declaration, together with the same-origin check, before
the handler runs, and hands the handler the authenticated caller. A handler that does not
declare its access cannot be written, so the text-searching guard-rail test of WS-023 is
replaced by a check on the declarations. The existing endpoints behave exactly as before.

## Acceptance criteria

- [x] An endpoint contract states its access as `public`, `authenticated` or
      `permission` with one permission from the catalogue; the old `public: boolean` field
      is gone.
- [x] `route(contract, handler)` rejects a cross-origin state-changing cookie request with
      `403`, an unauthenticated request to a non-public operation with `401`, and a caller
      without the declared permission with `403`, in that order, before the handler runs.
- [x] The handler of a non-public operation receives the authenticated caller; the handler
      of a public one receives none.
- [x] The `Set-Cookie` headers produced by authentication reach the response unless the
      handler set cookies of its own.
- [x] All twelve documented operations that use `route()` today, plus health and the
      OpenAPI document, are declared through `route(contract, ...)`; no handler calls
      `authenticate`, `requirePermission` or `assertSameOrigin` itself.
- [x] A test fails when an exported handler is not built from the contract of its own
      method and path, and when the set of authentication-only operations differs from the
      four approved in WS-015 and WS-021.
- [x] The OpenAPI document names the required permission of each permission-checked
      operation.
- [x] Every existing route integration test passes unchanged, except where the spec
      lists a deliberate change.
- [x] The full quality gate passes.

## Notes

Object-level rules, such as a Member deleting only tasks they reported, stay in the
services: the wrapper checks the permission named by the operation, nothing more.
