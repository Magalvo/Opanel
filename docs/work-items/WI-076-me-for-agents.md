# WI-076 — `GET /me` for agents

- Status: Done (2026-11-19)
- Work-track: [WT-05](../work-tracks/WT-05-agent-accounts-and-tokens.md) (item E,
  decision 9)
- Depends on: WI-072 (done)
- Work-spec: [WS-076](../work-specs/WS-076-me-for-agents.md)

## Outcome

An agent that calls `GET /api/v1/me` with its token learns who it is and what it may do:
its id, name, role, permissions (its scopes) and the projects it is restricted to, or
`null` for all. This is what the MCP server (WT-11, doc 0005 section 3) reads at start to
choose its tools. The response is one of two documented shapes, told apart by `kind`, so
the OpenAPI document stays generated from Zod. A human's response is unchanged apart from
one additive field, `projectIds: null`.

The other authentication-only operations already refuse tokens (WS-072 section 4), so
nothing else changes here.

## Acceptance criteria

- [x] `GET /me` with an agent token answers `200` with `kind: "agent"`, the agent's `id`,
      `name` and `role`, `permissions` equal to its stored scopes, and `projectIds` equal
      to its projects, or `null` when it is not restricted. The body has no `email`.
- [x] A restricted agent's `projectIds` and its `permissions` are sorted, so the same agent
      always gets the same body.
- [x] `GET /me` and `PATCH /me` with a session answer as before, plus `projectIds: null`.
- [x] `meResponseSchema` is a union discriminated by `kind`: a human body cannot carry
      agent fields or values, and an agent body cannot carry an `email`, a human role or
      a permission outside the agent scopes.
- [x] The OpenAPI document shows `Me` as one of `HumanMe` and `AgentMe`; `PATCH /me`
      answers `HumanMe`. The committed `docs/api/openapi.json` is regenerated.
- [x] Every existing consumer of `meResponseSchema` (UI, integration and E2E tests)
      type-checks and passes. The full quality gate passes.

## Notes

- The response never includes the token or anything about it (hard rule 7).
- Bearer scheme in the OpenAPI document: item C (WI-075). The end-to-end agent flow: item H.
