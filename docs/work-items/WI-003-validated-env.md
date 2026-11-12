# WI-003 — Validated environment variables

- Status: Proposed
- Work-track: [WT-01](../work-tracks/WT-01-project-boilerplate.md)
- Depends on: WI-001
- Work-spec: [WS-003](../work-specs/WS-003-validated-env.md)

## Outcome

Server configuration is read from environment variables through one typed, Zod-validated
module. A missing or malformed variable stops the server at startup with a message naming
the variable, instead of failing later in an unrelated place. This implements `AGENTS.md`
hard rule 4 for env vars and gives WI-004 a typed `DATABASE_URL` to build on.

## Acceptance criteria

- [ ] A single module is the only place in `src/` that reads `process.env`; an ESLint rule
      fails any other direct read.
- [ ] Valid input yields a typed, read-only configuration object.
- [ ] Invalid or missing input throws one error listing every offending variable by name.
- [ ] The error never contains a variable's value.
- [ ] Starting the server (`pnpm dev`, `pnpm start`) with invalid configuration fails
      immediately with that error.
- [ ] `pnpm build` succeeds without any environment variables set.
- [ ] `.env.example` documents every variable and is committed; real `.env` files stay
      ignored.
- [ ] The full existing quality gate passes.

## Notes

The database itself, and anything that connects to it, is WI-004.
