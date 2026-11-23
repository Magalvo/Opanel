# WS-112 — Production refuses the example session secret

- Status: Approved (approved by the owner on 2026-11-23, question 1 as proposed: the Playwright secret stays out of scope)
- Work-item: [WI-112](../work-items/WI-112-example-secret-refused.md)
- Canonical docs: [0006](../canonical/0006-operations.md) section 3 (configuration is the
  validated environment; the image adds no default secret); [WS-079](WS-079-production-secrets-split.md)
  (what each process reads); [WS-064](WS-064-schema-check.md) and
  `src/instrumentation.ts` (a bad environment stops the server)

## Approach

### 1. The refused values

`src/server/env.ts` gets one constant, next to the schema:

```ts
/**
 * `BETTER_AUTH_SECRET` values published in this repository (WS-112). Anyone can read them,
 * so a production server refuses them; development and tests use them on purpose.
 */
const PUBLISHED_AUTH_SECRETS: ReadonlySet<string> = new Set([
  "change-me-local-development-secret-0123456789", // .env.example
  "test-secret-only-for-vitest-0123456789abcdef", // .env.test
]);
```

An exact match, not a pattern ("contains change-me"): a pattern would refuse real secrets
by accident and still miss a published value that does not match it. Test 4 keeps the set in
step with the two files.

The Playwright secret (`E2E_AUTH_SECRET` in `tests/e2e/environment.ts`) is left out on
purpose: both Playwright suites build the app and run `next start`, which is
`NODE_ENV=production`, with that secret. See question 1.

### 2. The check

`envSchema` gets one object-level check, after the field schemas:

```ts
.superRefine((env, ctx) => {
  if (env.NODE_ENV === "production" && PUBLISHED_AUTH_SECRETS.has(env.BETTER_AUTH_SECRET)) {
    ctx.addIssue({
      code: "custom",
      path: ["BETTER_AUTH_SECRET"],
      message:
        "is an example value published with Opanel; generate one with `openssl rand -base64 32`",
    });
  }
})
```

The message is written by hand and never interpolates the value (AGENTS.md hard rule 7, as
the other messages of the file). `validationError` keeps the first issue per variable, so
the operator sees one line for `BETTER_AUTH_SECRET`.

An object-level check runs only once the fields themselves are valid. A configuration with
another error is reported for that error first, and for the published secret on the next
start. That is acceptable for a startup check and keeps the code simple. The exact rule of
Zod 4.6.7 for when an object's refinements run is checked in its installed documentation
before writing the code (hard rule 13). If they do run with field errors present, the check
must guard against an absent `BETTER_AUTH_SECRET` (its type says `string`, but the value is
then unvalidated).

Nothing else changes in the startup path. `src/instrumentation.ts` already catches
`EnvValidationError`, prints its message and calls `process.exit(1)` before the server
accepts a request. `migrate` does not read `BETTER_AUTH_SECRET` (WS-079), so it is not
affected.

### 3. Documentation

- `.env.example`: the comment above `BETTER_AUTH_SECRET` adds "A production server refuses
  this value."
- `docs/operations.md`, the `BETTER_AUTH_SECRET` line of the install steps adds: "The server
  refuses to start in production with a value published in the repository (`.env.example`,
  `.env.test`)."
- Canonical doc 0006 section 3, the configuration bullet: "the image adds no default
  secret" becomes "the image adds no default secret, and a production server refuses the
  example `BETTER_AUTH_SECRET` values published in the repository (WS-112)".

## Files

| Path                                | Change                                                    |
| ----------------------------------- | --------------------------------------------------------- |
| `src/server/env.ts`                 | modify: `PUBLISHED_AUTH_SECRETS` and the production check |
| `src/server/env.test.ts`            | modify: tests 1 to 5                                      |
| `.env.example`                      | modify: one comment line                                  |
| `docs/operations.md`                | modify: one sentence                                      |
| `docs/canonical/0006-operations.md` | modify: section 3, one bullet                             |
| WI-112, WS-112                      | modify: statuses, implementation record                   |

No dependency, no migration. `docs/README.md` changes only by index commits on `main`.

## Data model changes

None.

## API contract

None.

## Test plan (written first, in this order)

| #   | Level | Test                                                                                                                                                                   | Covers criterion |
| --- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit  | `env.test.ts`: with `NODE_ENV=production`, each of the two published values is refused; `variables` is `["BETTER_AUTH_SECRET"]`; the message names it and has no value | 1                |
| 2   | unit  | `env.test.ts`: with `NODE_ENV` `development`, `test` and unset, both values are accepted                                                                               | 2                |
| 3   | unit  | `env.test.ts`: with `NODE_ENV=production`, a 32-character secret that is not published is accepted                                                                     | 3                |
| 4   | unit  | `env.test.ts`: reads `.env.example` and `.env.test` from the repository root, and each `BETTER_AUTH_SECRET=` value in them is refused in production                    | 4                |
| 5   | unit  | `env.test.ts`: in production, a published secret together with another invalid variable still yields an `EnvValidationError` (no crash on the unvalidated value)       | 1                |

Criterion 5 (the server exits) relies on the existing path of `src/instrumentation.ts`,
already exercised for any `EnvValidationError`; this item adds no new startup code. It is
checked by hand once, recorded in the implementation record: `next start` with
`NODE_ENV=production` and the `.env.example` secret prints the message and exits with 1.
Criterion 7 is the existing Playwright suites. Criterion 6 is a review of the diff.

## Risks and open questions

1. **The Playwright secret.** `E2E_AUTH_SECRET` is also published, and also used with
   `NODE_ENV=production`. Refusing it too would need both Playwright configurations to
   generate a random secret per run (`randomBytes(32)` in `tests/e2e/environment.ts`; no
   test reads the secret, only the web server's environment does). Proposed: leave it out
   of this item. It lives in test code that no install guide points at, unlike
   `.env.example`, which the README tells people to copy. Owner to confirm.
2. **Other published values.** `SETUP_TOKEN` and the database passwords have no example
   value in the repository (`.env.example` leaves `SETUP_TOKEN` empty, `.env.production.example`
   leaves every secret empty), so nothing similar is needed for them. The development
   database URL `opanel:opanel` is published, but the production example install uses its
   own role and password (WS-063), and refusing a URL by its password is out of scope.
3. A secret that differs from a published one by a character is accepted. The check
   catches the copy, not a weak secret; strength beyond 32 characters stays the operator's
   job, as the operations guide says.
