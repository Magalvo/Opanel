# WI-079 — Each production service gets only the secrets it needs

- Status: Done (2026-11-19)
- Work-track: none: a hardening item from the audit of 2026-11-19 (finding B01)
- Depends on: none
- Work-spec: [WS-079](../work-specs/WS-079-production-secrets-split.md)

## Outcome

In the example install, `compose.production.yaml` hands the whole operator env file to every
service: the `x-app` anchor gives `migrate` and `app` `env_file: ${OPANEL_ENV_FILE:-.env.production}`
(`compose.production.yaml:20-24`) and `db` reads the same file (`:36`). So the running app
holds `MIGRATION_DATABASE_URL` and `POSTGRES_PASSWORD`, the schema owner's credentials, and
PostgreSQL holds `BETTER_AUTH_SECRET` and `SETUP_TOKEN`. A compromised app process can then
connect as the owner and drop tables or disable the append-only triggers, which canonical
doc 0006 section 5 says it cannot.

After this item the operator still fills in one env file, unchanged, but Compose gives each
service only its own variables: the app no owner credential, `migrate` only the owner's
connection, and the database no app secret. `migrate` no longer needs the app's settings to
start.

## Acceptance criteria

- [x] The `app` container's environment has no `MIGRATION_DATABASE_URL`, `POSTGRES_PASSWORD`
      or `OPANEL_APP_DB_PASSWORD`.
- [x] The `db` container's environment has no `BETTER_AUTH_SECRET`, `SETUP_TOKEN`,
      `APP_URL`, `DATABASE_URL` or `MIGRATION_DATABASE_URL`.
- [x] The `migrate` container's environment has no `BETTER_AUTH_SECRET`, `SETUP_TOKEN`,
      `DATABASE_URL`, `POSTGRES_PASSWORD` or `OPANEL_APP_DB_PASSWORD`, and it migrates.
- [x] `migrate` validates only its own connection: it runs without `BETTER_AUTH_SECRET` and
      `APP_URL`, and a missing or invalid connection names the variable, never its value.
- [x] An existing install's single `.env.production` works unchanged; the operations guide
      says how to upgrade, and the `OPANEL_ENV_FILE` knob keeps working.
- [x] Every existing check of `smoke-production.sh`, `smoke-proxy.sh` and
      `rehearse-backup.sh` still passes, and the smoke test checks the three lists above
      without printing a value.
- [x] Canonical doc 0006 states the rule: the app's environment holds no owner credential.
- [x] `docs/operations.md` still passes its test (variables it names are known).
- [x] The full quality gate passes.

## Notes

Files this item modifies include `docs/canonical/0006-operations.md` (sections 3 and 5).
WS-062 (`:84`, deviation 3 at `:182-184`) chose "both read env_file"; it stays as the
record of that decision, superseded by this item. The development and CI file,
`compose.yaml`, is not affected.
