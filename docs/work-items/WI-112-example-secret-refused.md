# WI-112 — Production refuses the example session secret

- Status: Proposed
- Work-track: none: a finding of the project audit of 2026-11-23
- Depends on: none
- Work-spec: [WS-112](../work-specs/WS-112-example-secret-refused.md)

## Outcome

A production server does not start with a `BETTER_AUTH_SECRET` that is published in this
repository. Today `src/server/env.ts` only asks for 32 characters, so an operator who copies
`.env.example` (or `.env.test`) to a production server gets sessions signed and encrypted
with a secret anyone can read on GitHub, and so sessions anyone can forge. The server now
stops at startup and says which variable to change, without printing its value.

Development and test configurations are unchanged: the published values stay usable there,
which is what they are for.

## Acceptance criteria

- [ ] With `NODE_ENV=production`, a `BETTER_AUTH_SECRET` equal to the value in
      `.env.example` or in `.env.test` is refused by `parseEnv`: an `EnvValidationError`
      that names `BETTER_AUTH_SECRET`, says it is a published example value and how to
      generate one, and does not contain the value.
- [ ] With `NODE_ENV=development` or `test`, the same values are accepted.
- [ ] With `NODE_ENV=production`, any other secret of 32 characters or more is accepted, as
      today.
- [ ] A test fails if `.env.example` or `.env.test` holds a `BETTER_AUTH_SECRET` that the
      refused list does not contain, so the list cannot fall behind the files.
- [ ] The server started with `next start` and such a secret exits with code 1 before it
      accepts a request (the existing `EnvValidationError` path of `src/instrumentation.ts`).
- [ ] `.env.example`, `docs/operations.md` and canonical doc 0006 section 3 say that a
      production server refuses the published values.
- [ ] The Playwright suites, which run `next start` with their own published secret, pass
      unchanged.
- [ ] The full quality gate passes.

## Notes

Found by the audit of 2026-11-23 (severity medium: a configuration mistake, not a code
path an attacker can trigger, but its consequence is session forgery). No API, data model
or UI change.
