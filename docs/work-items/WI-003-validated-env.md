# WI-003 — Validated environment variables

- Status: Done
- Work-track: [WT-01](../work-tracks/WT-01-project-boilerplate.md)
- Depends on: WI-001
- Work-spec: [WS-003](../work-specs/WS-003-validated-env.md)

## Outcome

Server configuration is read from environment variables through one typed, Zod-validated
module. A missing or malformed variable stops the server at startup with a message naming
the variable, instead of failing later in an unrelated place. This implements `AGENTS.md`
hard rule 4 for env vars and gives WI-004 a typed `DATABASE_URL` to build on.

## Acceptance criteria

- [x] A single module is the only place in `src/` that reads `process.env`; an ESLint rule
      fails any other direct read.
- [x] Valid input yields a typed, read-only configuration object.
- [x] Invalid or missing input throws one error listing every offending variable by name.
- [x] The error never contains a variable's value.
- [x] Starting the server (`pnpm dev`, `pnpm start`) with invalid configuration fails
      immediately with that error.
- [x] `pnpm build` succeeds without any environment variables set.
- [x] `.env.example` documents every variable and is committed; real `.env` files stay
      ignored.
- [x] The full existing quality gate passes.

## Notes

The database itself, and anything that connects to it, is WI-004.
