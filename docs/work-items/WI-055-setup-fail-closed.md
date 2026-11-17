# WI-055 — Production setup requires a setup token

- Status: Done
- Work-track: none: a hardening item from the audit of 2026-11-17 (finding A02). It amends
  WT-04 decision 13 (amendment A1) and WS-050, which made the token optional everywhere.
- Depends on: none
- Work-spec: [WS-055](../work-specs/WS-055-setup-fail-closed.md)

## Outcome

Since WI-050 a server **can** protect its first-run setup with `SETUP_TOKEN`. But the token
is optional, so a production server started without it is still claimed by whoever reaches
`/setup` first: the safe behaviour depends on the operator remembering a step.

After this item a server running with `NODE_ENV=production` refuses the first-run setup
while no `SETUP_TOKEN` is configured. The setup page says so and tells the operator what to
set, instead of showing the form. Development and test keep today's behaviour. Once the
first Admin exists, nothing changes: setup is a `404` whatever the token, and the token can
be removed, as today.

## Acceptance criteria

- [x] With `NODE_ENV=production`, no `SETUP_TOKEN` and no accounts,
      `POST /api/v1/setup` answers `403` with code `setup_token_not_configured`, hashes
      nothing and writes nothing.
- [x] In the same state the setup page shows no form, only an explanation naming
      `SETUP_TOKEN` and pointing to `.env.example`.
- [x] With `NODE_ENV=production` and a `SETUP_TOKEN`, setup works as in WS-050.
- [x] With `NODE_ENV` `development` or `test` and no `SETUP_TOKEN`, setup works as today.
- [x] Once any account exists, setup is `404` in every mode, with or without a token.
- [x] The server still starts in production without `SETUP_TOKEN` (an installed server
      does not need one).
- [x] The end-to-end suite, which runs the production build, sets a token and its first-run
      test fills the "Setup token" field.
- [x] The contract documents the new `403` code; the OpenAPI document is regenerated.
- [x] The full quality gate passes.

## Notes

The audit also suggested a local provisioning command instead of a token; WS-055 explains
why it is not proposed here (question 3).
