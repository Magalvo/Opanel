# Contributing to Opanel

Thank you for helping. This page is a summary; the rules themselves live in
[AGENTS.md](AGENTS.md), which applies equally to people and to AI contributors. If this
page and `AGENTS.md` ever disagree, `AGENTS.md` wins — and please report the mismatch.

Setup instructions are in the [README](README.md#getting-started).

## How a change happens

Opanel is spec-driven. Nothing is implemented until its plan has been written down and
approved by the project owner. The full description is in `AGENTS.md`, section 4.

1. **Read** `AGENTS.md`, the index in [docs/README.md](docs/README.md), and the canonical
   docs in [docs/canonical/](docs/canonical/) that relate to your change.
2. **Find or propose a work-item**: one small, independently shippable task
   ([template](docs/work-items/_TEMPLATE.md)). Do not widen its scope as you go.
3. **Write the work-spec**: the files you will touch, any data model or API changes, and
   the tests you will write ([template](docs/work-specs/_TEMPLATE.md)). Mark it `Proposed`.
4. **Wait for approval.** The owner marks the work-spec `Approved`.
5. **Implement with TDD** (below).
6. **Update the docs**: the statuses of the work-item and work-spec, the index, and any
   canonical doc whose content your change affects.

## Test-driven development

For every change, in this order:

1. **Red** — write a test that fails for the right reason, and watch it fail.
2. **Green** — write the minimum code that makes it pass.
3. **Refactor** — tidy up with every test still passing.

There are three levels of test:

| Level       | Tool       | Where                                    | Notes                                          |
| ----------- | ---------- | ---------------------------------------- | ---------------------------------------------- |
| Unit        | Vitest     | `*.test.ts(x)` next to the code          | Pure logic, schemas, components.               |
| Integration | Vitest     | `*.integration.test.ts` next to the code | Runs against a real PostgreSQL. Never mocked.  |
| End-to-end  | Playwright | [tests/e2e/](tests/e2e/)                 | Drives the production build in a real browser. |

Before your first end-to-end run, install the browser:

```bash
pnpm exec playwright install chromium
```

## Local database

`docker compose up -d` starts one PostgreSQL server holding three databases:

| Database          | Used by           | Notes                               |
| ----------------- | ----------------- | ----------------------------------- |
| `opanel`          | `pnpm dev`        | Your development data.              |
| `opanel_test`     | Integration tests | Emptied before every test.          |
| `opanel_e2e_test` | End-to-end tests  | The database of the app under test. |

The test harnesses refuse to run against any database whose name does not end in `_test`,
so tests cannot erase development data.

**Port 5432 already in use?** Start the server on another port and point the app at it:

```bash
OPANEL_DB_PORT=5433 docker compose up -d
```

Then change the port in `DATABASE_URL` in your `.env`. The tests read their own settings,
so for them set `DATABASE_URL` (integration) and `E2E_DATABASE_URL` (end-to-end) in your
shell to the same port, for example
`DATABASE_URL=postgres://opanel:opanel@localhost:5433/opanel_test pnpm test`.

**Start again from an empty server** (this deletes all local data):

```bash
docker compose down -v
docker compose up -d
```

## Quality gate

All five must pass before a change is accepted. CI runs the same five on every pull
request, on a clean machine.

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm test:e2e
```

Do not weaken a check to make it pass: no `any`, no skipped or deleted tests, no
`eslint-disable` without a reason. The complete list is in `AGENTS.md`, section 6.

## Commits and pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org/) and reference the
  work-item, for example `feat(triage): add bug report endpoint (WI-012)`.
- One work-item per branch and pull request. Keep unrelated changes out.
- `main` is always green.
