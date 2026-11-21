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
   ([template](docs/work-items/_TEMPLATE.md)). Do not widen its scope as you go. A new
   work-item gets its number reserved by a commit on `main` before its branch starts
   (`AGENTS.md` section 4). If you cannot push to `main`, propose the work-item in an issue
   or a pull request, and the owner reserves its number.
3. **Write the work-spec**: the files you will touch, any data model or API changes, and
   the tests you will write ([template](docs/work-specs/_TEMPLATE.md)). Mark it `Proposed`.
4. **Wait for approval.** The owner marks the work-spec `Approved`.
5. **Implement with TDD** (below).
6. **Update the docs**: the `Status:` lines of the work-item and work-spec, and any
   canonical doc whose content your change affects. A branch never edits the index,
   `docs/README.md`: it changes only by index commits on `main` (`AGENTS.md` section 4).

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
so tests cannot erase development data. They create their database when it is missing and
migrate it, so a new name never needs `docker compose down -v`.

**Several worktrees at once** (WS-095). Each linked Git worktree (`git worktree add`) gets
its own test databases and end-to-end ports, so several worktrees can run `pnpm test` and
`pnpm test:e2e` at the same time. The main checkout and CI have no ID and use the names and
ports above.

- **The ID** is the first 8 hex characters of the SHA-256 of the worktree's path, for
  example `3f9a07c2`. Set `OPANEL_WORKTREE` (1 to 16 lower-case letters or digits) to
  choose it, in any checkout. Moving the worktree's folder changes the ID.
- **The databases** get the ID before their suffix: `opanel_3f9a07c2_test` and
  `opanel_3f9a07c2_e2e_test`. This applies to the names in `DATABASE_URL` and
  `E2E_DATABASE_URL` too, when you set them.
- **The ports**: the app's end-to-end run uses 20000 to 20999 and the PostHog add-on's
  21000 to 21999, from the ID (3100 and 3200 without one). `E2E_PORT` and
  `OPANEL_ADDON_E2E_PORT` choose them. Two worktrees share a port about once in a
  thousand pairs; a run whose port is already in use stops at once and names the variable
  to set.
- **Dropping them.** `pnpm test:db:drop` drops this checkout's two test databases.
  `pnpm test:db:drop --stale` lists the databases of worktrees that no longer exist (any
  `opanel_<id>_test` or `opanel_<id>_e2e_test` whose ID is not one of
  `git worktree list`), and `pnpm test:db:drop --stale --yes` drops them; run it from any
  checkout after removing worktrees. A database in use is kept.

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

## Database roles and migrations

The app connects as `opanel_app`, a role with only the rights it needs; migrations connect
as the schema owner (`MIGRATION_DATABASE_URL`, else `DATABASE_URL`; WS-063). Default
privileges give `opanel_app` `SELECT`, `INSERT`, `UPDATE` and `DELETE` on every table a
migration creates, so a new table needs no grant. A migration that creates an append-only
table (one with an `*_append_only` trigger) also runs
`REVOKE UPDATE, DELETE ON <table> FROM opanel_app`. The test
`src/server/db/runtime-role.integration.test.ts` fails if either is missing.

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

If `pnpm typecheck` reports errors mentioning `RouteImpl` for a path that exists, the
route types generated by an earlier build are out of date: delete the `.next` directory
(or run `pnpm build`) and run it again. A fresh clone and CI are not affected.

The toolchain of reference is the one CI runs: Node.js from `.nvmrc` and the pnpm of
`packageManager` in `package.json`. `corepack enable` gives you that pnpm; any other pnpm
version stops with a message naming both versions (WS-060). CI also runs the format check
on Windows.

Every text file is LF, in the repository and in every checkout (`.gitattributes`). A clone
made before that file existed (2026-11-18) still has CRLF files on Windows, and
`pnpm format:check` fails on them. Check them out again once, with a clean working tree:

```bash
git rm -r --cached --quiet . && git reset --hard --quiet
```

End-to-end tests run in parallel against one shared database, so a test must not change
state that other tests rely on, such as deactivating Admins it did not create. A test that
has to (today only `tests/e2e/last-admin.spec.ts`) goes in the `exclusive` project of
`playwright.config.ts`, which runs alone before the others (WS-052).

Locally the end-to-end suite uses at most 4 workers (CI uses Playwright's default). More
can be asked for with `pnpm test:e2e --workers=8`, at the cost of timeouts on a busy
machine (WS-054).

Do not weaken a check to make it pass: no `any`, no skipped or deleted tests, no
`eslint-disable` without a reason. The complete list is in `AGENTS.md`, section 6.

## Dependency advisories

The `Dependency audit` workflow (`.github/workflows/audit.yml`) runs `pnpm audit --prod`
weekly and on every change to the dependencies. When it fails:

1. Look at the advisory's path (`pnpm why <package>`) and whether Opanel can reach the
   vulnerable code at all.
2. Prefer upgrading the package that brings it in.
3. If no upgrade exists, add a scoped override (`"parent>package"`) to the `overrides` of
   `pnpm-workspace.yaml`, with a comment naming the advisory and the work-spec that
   decided it (as WS-053 did for esbuild).
4. Never ignore an advisory wholesale, and never override a package everywhere when one
   path is enough. An advisory with no fix published and no path Opanel runs in production
   may be ignored by its id in `auditConfig.ignoreGhsas` of `pnpm-workspace.yaml`, decided
   in a work-spec and with a comment naming it. The audit workflow fails as soon as such
   an advisory has a fix (WS-061).

## Content Security Policy

Every page is served with a Content Security Policy (WS-041), built in
`src/lib/security-headers.ts` and set by `src/proxy.ts` with a new nonce for each request.
Scripts run only if they carry that nonce; Next.js adds it to its own scripts. So, in UI
code:

- no inline event handlers in markup (`onclick="..."`), no `eval` or `new Function`, and
  no scripts or fonts from other sites;
- an inline script that cannot be avoided gets the nonce: read `x-nonce` from the request
  headers in a server component, as `src/app/layout.tsx` does for the theme script;
- inline `style` attributes are allowed.

Every end-to-end spec imports `test` from `tests/e2e/base.ts` (or `fixtures.ts`), which
fails a test when its page reports a policy violation, so a page that breaks the policy is
caught by the change that introduces it.

## Commits and pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org/) and reference the
  work-item, for example `feat(triage): add bug report endpoint (WI-012)`.
- One work-item per branch and pull request. Keep unrelated changes out.
- `main` is always green.
