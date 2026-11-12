# WI-006 — OpenAPI document generated from Zod

- Status: Done
- Work-track: [WT-01](../work-tracks/WT-01-project-boilerplate.md)
- Depends on: WI-005
- Work-spec: [WS-006](../work-specs/WS-006-openapi.md)

## Outcome

The API describes itself. An OpenAPI 3.1 document is generated from the same Zod schemas
the route handlers use, served by the app, and kept as a file in the repository. Authors
of external AI agents (in any language) get a machine-readable contract, and any change to
the API shows up as a reviewable diff. This implements `AGENTS.md` hard rule 9.

## Acceptance criteria

- [x] `GET /api/v1/openapi.json` returns a valid OpenAPI 3.1 document describing
      `GET /api/v1/health`, including both responses and their schemas.
- [x] The document is generated from the Zod schemas in `src/lib/schemas`; no response or
      request shape is written by hand a second time.
- [x] A test fails if an API route exists without an entry in the document, or the
      document describes a route that does not exist.
- [x] `docs/api/openapi.json` is committed, `pnpm openapi:generate` rewrites it, and a
      test fails when the committed file differs from the generated document.
- [x] The document validates against the official OpenAPI 3.1 schema in a test.
- [x] The full existing quality gate passes.

## Notes

A browsable documentation page (Swagger UI, Scalar or similar) is not part of this item.
