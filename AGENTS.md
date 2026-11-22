# AGENTS.md — Opanel project constitution

> Status: **Approved** by the owner on 2026-11-12. Changes require owner approval.
> This file is the first thing every contributor (human or AI) reads. Keep it under 300 lines.

## 1. Purpose

Opanel is an open-source (MIT) project management web app: a modern Jira alternative built
from day one for **human engineering teams and autonomous AI agents working side by side**.

Three pillars:

1. **Task management** — projects, epics, tasks, kanban columns, statuses, assignments to
   teams and people.
2. **Agents as first-class accounts** — an AI agent has its own identity, role, scopes and
   credentials, and every action it takes is attributable to it.
3. **Automated triage** — external AI QA agents test a product's UI and API, submit
   structured bug reports, and Opanel turns each report into a ticket routed to the
   responsible team (Frontend, API or Backend).

### Scope boundaries (v1)

- Opanel does **not** run, schedule or host AI agents. Agents are external clients of the
  public API. Opanel contains no LLM calls.
- Self-hosted, **one organization per install**, many teams and projects.
- Human sign-in is email + password. No OAuth/SSO in v1.
- Boards sync live between members. No file attachments and no notifications in v1.

## 2. Tech stack

| Concern                | Choice                                                             |
| ---------------------- | ------------------------------------------------------------------ |
| Language               | TypeScript, `strict` mode, no `any`                                |
| App                    | Next.js (App Router) monolith: UI + API route handlers             |
| API                    | Versioned REST under `/api/v1`, OpenAPI generated from Zod         |
| Database               | PostgreSQL                                                         |
| Human auth             | Better Auth (email + password, sessions in PostgreSQL)             |
| Password hashing       | Argon2id via @node-rs/argon2                                       |
| Agent auth             | Custom scoped API tokens (canonical doc 0001)                      |
| Live sync              | Server-Sent Events + PostgreSQL LISTEN/NOTIFY (canonical doc 0002) |
| Agent tools            | MCP server over stdio, a client of `/api/v1` (canonical doc 0005)  |
| ORM, migrations        | Drizzle ORM + drizzle-kit                                          |
| Validation             | Zod (single source for runtime validation, types and OpenAPI)      |
| UI                     | React, Tailwind CSS, shadcn/ui                                     |
| Unit/integration tests | Vitest                                                             |
| End-to-end tests       | Playwright                                                         |
| Lint, format           | ESLint + Prettier                                                  |
| Package manager        | pnpm                                                               |
| Local infra            | Docker Compose (PostgreSQL)                                        |
| CI                     | GitHub Actions                                                     |

Exact versions are pinned in `package.json` by the work-spec that adds each dependency, not
here. Adding, removing or swapping a dependency in this table requires a canonical doc
change first.

## 3. Directory conventions

Layout (created by the boilerplate work-track, WT-01):

```
AGENTS.md               This file
docs/                   All specs (see section 4)
src/
  app/                  Next.js routes: pages and /api/v1 route handlers
  components/           React components (app-specific)
    ui/                 shadcn/ui components, copied in and owned by this repo
  hooks/                Shared React hooks
  styles/               Vendored CSS that globals.css imports
  server/
    db/                 Drizzle schema, migrations, DB client
    services/           Domain logic (the only layer that touches the DB)
    auth/               Sessions, API tokens, permission checks
    http/               Shared route-handler helpers: errors, input parsing, responses
  lib/
    schemas/            Zod schemas shared by API, UI and OpenAPI
tests/
  e2e/                  Playwright specs
mcp/                    MCP server package (doc 0005, WT-11): a client of /api/v1, no DB access
addons/                 Optional add-ons (WT-13), one directory each: clients of /api/v1, no DB
                        access, outside the app's build; the app never depends on them
```

Layering rules:

- Route handlers and server components are thin: authenticate, validate with Zod, call a
  service, shape the response. No business logic, no direct DB access.
- Services own business rules and are the only code that imports the DB client.
- The web UI consumes the same `/api/v1` endpoints agents use. No private side-channel API.
- Unit and integration tests are colocated as `*.test.ts(x)` next to the code under test.

## 4. Spec-driven workflow (4 layers)

AI contributors have **no persistent memory**. The docs in this repo are the only context
that carries between sessions. If it is not written down here, it was not decided.

| Layer         | Location            | Answers                                   | Naming           |
| ------------- | ------------------- | ----------------------------------------- | ---------------- |
| Canonical doc | `docs/canonical/`   | Why and how the system is built (lasting) | `NNNN-slug.md`   |
| Work-track    | `docs/work-tracks/` | An epic: goal, scope, list of work-items  | `WT-NN-slug.md`  |
| Work-item     | `docs/work-items/`  | One atomic, independently shippable task  | `WI-NNN-slug.md` |
| Work-spec     | `docs/work-specs/`  | Exactly how one work-item is implemented  | `WS-NNN-slug.md` |

A work-spec shares its number with its work-item. Templates are the `_TEMPLATE.md` file in
each directory. A doc's status is the `Status:` line at its top, and only there (an
approval is recorded on that line). `docs/README.md` is the index: links and titles, what
comes next, and follow-ups.

Flow for any change:

1. Read `AGENTS.md`, `docs/README.md`, and the canonical docs relevant to the task.
2. Find the work-item. If none exists, propose one; do not improvise scope. A new
   work-item (or work-track, or canonical doc) first gets its number reserved on `main`
   (below), and its branch starts from that commit.
3. Draft the work-spec: files touched, data model changes, API contract, and the list of
   tests to write. Mark it `Proposed`.
4. **Stop. The owner approves the work-spec** (status becomes `Approved`).
5. Implement with TDD (section 5).
6. Update the statuses of the work-item and work-spec, and update canonical docs if
   behavior or architecture changed.

**Index commits.** Only small docs-only commits pushed straight to `main` change
`docs/README.md`; a work-item branch never edits it, so parallel branches never conflict
there. There are three kinds:

- **Reserve a number** (`docs: reserve WI-NNN (slug)`). `git fetch origin`; take one more
  than the highest number on `origin/main` (index and file names); on a checkout of
  `origin/main` add the doc from its template (title, `Status: Draft`) and its index row
  (with the work-spec link, for a work-item); commit and push. If the push is refused
  because `main` moved, fetch, rebase, take the number again and retry. A reserved number
  is never reused or renamed; a dropped item becomes `Superseded`.
- **Record a follow-up** (`docs: follow-up from WI-NNN`), also written in the work-spec.
- **Move "Where the project stands"** (`docs: next is ...`), when a work-track is approved
  or done, or what comes next changes.

If `main` is ever protected, an index commit is a one-file pull request, merged at once.
`scripts/docs-index.test.ts` checks the index against the docs.

## 5. TDD and guardrails

For every work-item, in this order:

1. **Red** — write a test that fails for the right reason. Run it and see it fail.
2. **Green** — write the minimum code that makes it pass.
3. **Refactor** — clean up with all tests still green.

Test levels:

- **Unit** (Vitest): pure logic, Zod schemas, permission checks.
- **Integration** (Vitest): services and route handlers against a **real PostgreSQL**
  database. The database is never mocked.
- **E2E** (Playwright): critical user and agent flows through the running app.

Quality gate (all must pass locally and in CI before a work-item is done):

```
pnpm check        # typecheck, lint and format:check, in parallel
pnpm test         # Vitest unit + integration
pnpm test:e2e     # Playwright
```

`pnpm check` is exactly the other three checks, each of which also runs alone:
`pnpm typecheck` (route types, then `tsc --noEmit`), `pnpm lint` (ESLint, zero warnings)
and `pnpm format:check` (Prettier). `test` and `test:e2e` need the database:
`docker compose up -d`.

## 6. Hard rules

1. No application code without an `Approved` work-spec.
2. No implementation code before a failing test exists for it.
3. Never weaken a guardrail to get green: no `any`, no `@ts-ignore`/`@ts-expect-error`
   without a linked work-item, no `eslint-disable` without a reason comment, no skipped or
   deleted tests.
4. All external input (request bodies, params, env vars) is validated with Zod at the
   boundary.
5. Every schema change is a Drizzle migration committed with the code. Never edit an
   applied migration.
6. Every API endpoint enforces authentication and an explicit permission check, except
   endpoints that a work-spec explicitly declares public. Public endpoints must not expose
   data or internal detail. Agents get no implicit permissions.
7. Secrets never enter the repo, logs, or API responses. API tokens are stored hashed and
   shown exactly once.
8. Every state-changing action records the acting account (human or agent) in the audit log
   or, for task and comment changes, the task history (canonical doc 0003 section 9).
9. Any change to a `/api/v1` contract updates the Zod schema, so the OpenAPI spec stays
   generated, never hand-written. Breaking changes require a new API version.
10. One work-item per branch/PR. Keep unrelated changes out.
11. When a doc and the code disagree, stop and raise it. Do not silently pick one.
12. When requirements are unclear, ask the owner. Do not assume.
13. Before writing code against a framework or library, read the documentation for the
    **installed version** (for Next.js: `node_modules/next/dist/docs/`). Installed versions
    are newer than what an AI contributor may remember; do not rely on recalled APIs.

## 7. Definition of done

- Work-spec acceptance criteria are met, each covered by a test.
- The full quality gate passes.
- The work-item and work-spec `Status:` lines are updated (not `docs/README.md`: see the
  index commits in section 4).
- Canonical docs reflect any new decision.

## 8. Git conventions

- Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`),
  referencing the work-item, e.g. `feat(triage): add bug report endpoint (WI-012)`.
- Small commits that follow the Red, Green, Refactor steps are welcome.
- `main` is always green.
- Before a branch merges, it takes in `main` (rebase or merge), then: if it adds a
  migration and `main` gained one meanwhile, it deletes its own migration and snapshot
  and runs `pnpm db:generate` again; it runs `pnpm openapi:generate` if it changes the
  API; and it runs the full quality gate again on the result.
