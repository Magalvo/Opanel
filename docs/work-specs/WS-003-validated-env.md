# WS-003 — Validated environment variables

- Status: Approved (2026-11-12)
- Work-item: [WI-003](../work-items/WI-003-validated-env.md)
- Canonical docs: `AGENTS.md` sections 3 and 6 (hard rules 4 and 7)

## Approach

Split the module into a pure function and a cached accessor:

- `parseEnv(source)` takes a plain record, validates it with a Zod schema and returns a
  frozen, typed object or throws `EnvValidationError`. It has no side effects, so it is
  unit-tested directly with hand-built records.
- `getEnv()` calls `parseEnv(process.env)` once and caches the result. All server code
  uses `getEnv()`.

Validation is triggered at server startup from `src/instrumentation.ts`, whose `register`
function Next.js runs once before the server accepts requests (per the docs shipped with
the installed Next.js 16.4.6). Nothing calls `getEnv()` at module load, so `next build`
does not need runtime configuration.

No environment library is added (for example `@t3-oss/env-nextjs`): the need is about
thirty lines of Zod, and there are no client-side variables yet.

### Variables in this item

| Variable       | Rule                                                         | Default       |
| -------------- | ------------------------------------------------------------ | ------------- |
| `NODE_ENV`     | `development`, `test` or `production`                        | `development` |
| `DATABASE_URL` | Required. A URL with the `postgres:` or `postgresql:` scheme | none          |

`DATABASE_URL` is introduced here, one item before the database, so that this item has a
real required value to validate and WI-004 can consume it without touching the schema.
Later items add their own variables to the same schema.

### Error format

One error for all problems, names only, never values (hard rule 7):

```
Invalid environment configuration:
  - DATABASE_URL: required
  - NODE_ENV: must be one of development, test, production
See .env.example.
```

## Versions

| Package | Version | Kind       |
| ------- | ------- | ---------- |
| `zod`   | 4.6.7   | dependency |

## Files

| Path                     | Change                                                                    |
| ------------------------ | ------------------------------------------------------------------------- |
| `package.json`, lockfile | modify: add `zod`                                                         |
| `src/server/env.ts`      | create: schema, `parseEnv`, `getEnv`, `EnvValidationError`, `Env` type    |
| `src/server/env.test.ts` | create: unit tests (written first)                                        |
| `src/instrumentation.ts` | create: `register()` calls `getEnv()` when running in the Node.js runtime |
| `.env.example`           | create: both variables with comments; local-development `DATABASE_URL`    |
| `eslint.config.mjs`      | modify: forbid `process.env` outside `src/server/env.ts` and config files |
| `vitest.config.ts`       | modify only if tests need `NODE_ENV`/env isolation                        |

The ESLint restriction uses the core `no-restricted-properties` rule (object `process`,
property `env`) with an override that allows it in `src/server/env.ts` and in root-level
config files.

## Data model changes

None.

## API contract

None.

## Test plan (written first, in this order)

| #   | Level        | Test                                                                                              | Covers criterion     |
| --- | ------------ | ------------------------------------------------------------------------------------------------- | -------------------- |
| 1   | unit         | `parseEnv` with a valid record returns the typed values                                           | valid input          |
| 2   | unit         | `NODE_ENV` omitted defaults to `development`                                                      | defaults             |
| 3   | unit         | missing `DATABASE_URL` throws `EnvValidationError` naming `DATABASE_URL`                          | invalid input        |
| 4   | unit         | `DATABASE_URL` with a non-Postgres scheme, or not a URL, is rejected                              | invalid input        |
| 5   | unit         | two invalid variables are both listed in a single error                                           | lists every variable |
| 6   | unit         | the error message does not contain the rejected value (tested with a URL holding a fake password) | no values in errors  |
| 7   | unit         | the returned object is frozen                                                                     | read-only            |
| 8   | unit         | `getEnv` parses once and returns the same object on later calls                                   | single source        |
| 9   | manual, once | `process.env.X` in another `src/` file fails `pnpm lint`; removed                                 | lint restriction     |
| 10  | manual, once | `pnpm dev` without `DATABASE_URL` exits with the error; with `.env` it serves `/`                 | fail fast at startup |
| 11  | gate         | `pnpm build` with no variables set; `typecheck`, `lint`, `format:check`, `test` pass              | build and gate       |

## Risks and open questions

1. `register()` behaviour in `next dev` (whether a thrown error stops the process or is
   only logged) is to be confirmed against the installed version during implementation.
   If it only logs, the fallback is to exit the process explicitly from `register()` and
   record that here.
2. After this item `pnpm dev` requires a `.env` file. Until WI-004 adds the database, the
   example value points at a database that does not exist yet; nothing connects to it.
