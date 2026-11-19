# WS-078 — The agent flow end to end, and the guide for agent authors

- Status: Done (approved by the owner on 2026-11-19, questions 1 to 4 as proposed)
- Work-item: [WI-078](../work-items/WI-078-agent-flow-and-guide.md)
- Canonical docs: [0001](../canonical/0001-ai-qa-agents-and-triage.md) (sections 3 and 4);
  [0004](../canonical/0004-api-conventions.md) (the conventions the guide summarizes);
  [0002](../canonical/0002-realtime-sync.md) (the events stream);
  [WT-05](../work-tracks/WT-05-agent-accounts-and-tokens.md) (item H, exit criteria);
  [WS-070](WS-070-operations-guide.md) (the guide check this one reuses)

## Approach

### 1. Where things stand (checked on 2026-11-19, `main` at `5336904`)

- Everything an agent uses exists and is tested piece by piece:
  - tokens (WS-072), the Admin API (WS-075), project restrictions (WS-073), `GET /me`
    for agents (WS-076), the Agents page (WS-077) and the Agent badge (WS-074);
  - the existing tests cover the `401` refusals, the stream closing on revocation, the
    rate limit (with a small limiter, and the 600 default in a unit test), and audit
    entries with no token in them.
- **Not proved yet**, against WT-05's exit criteria:
  - **the whole flow in one test**, from the Admin's click to the agent's own requests;
  - **"no agent can hold a `*:manage` or delete permission, tried through the API"**: the
    database side is tested (WS-071). Through the API, only `tasks:write` on a QA agent
    and `agents:manage` at the schema level are tried, not every permission;
  - **an agent's action attributed to it in the task data**: covered for display by the
    Agent badge test, which seeds the comment directly in the database, not through a
    token.
- There is no guide for agent authors. What they can read today is the OpenAPI document
  (with `bearerAuth` and `x-opanel-permission`) and doc 0001, which is a design doc.
- `scripts/operations-guide.test.ts` (WS-070) checks a guide against the repository. Its
  checker, `guideProblems`, is local to that test file.

### 2. The end-to-end test: `tests/e2e/agent-flow.spec.ts`

One test, as an agent author would live it:

1. **Admin, in the UI** (an Admin seeded as in `agents.spec.ts`):
   - creates two projects through the API, A and B, and a task in A;
   - creates "Flow bot", a QA agent restricted to A, on the Agents page;
   - creates a token in the dialog and reads it from the dialog.
2. **Agent, with the token only**: a new `APIRequestContext` from
   `playwright.request.newContext({ baseURL, extraHTTPHeaders: { Authorization } })`, so
   no cookie can help it.
   - `GET /api/v1/me` gives `kind: "agent"`, the four QA scopes, and `projectIds` with
     A's id only.
   - `GET /api/v1/projects` lists only A.
   - `GET /api/v1/tasks/{A's task}` answers `200`.
   - `POST /api/v1/tasks/{A's task}/comments` answers `201`, and its author is the agent.
   - `GET /api/v1/projects/{B}` answers `403`, and `POST /api/v1/projects/{A}/tasks`
     answers `403` (no `tasks:write`).
   - The events stream for A answers `200` with `text/event-stream`, read with Node's
     `fetch` and an `AbortController`: the test reads the first frame (`: connected`)
     and aborts. The stream for B answers `403`.
3. **Admin again, in the UI**: the task's detail shows the comment by "Flow bot" with the
   Agent badge.

Closing the stream on revocation needs a 25-second heartbeat in the production build. It
is already proved by integration tests with a short heartbeat (WS-072), so it is not
repeated here.

### 3. Integration tests that close two exit criteria

- **`src/app/api/v1/agents/permissions.integration.test.ts`**: for every permission in
  `PERMISSIONS` that is not in `AGENT_SCOPES`, `POST /api/v1/agents` (with that scope, and
  `role: "worker_agent"`) and `PATCH /api/v1/agents/{id}` (with that scope) answer `400`
  with the field error `scopes`. The list is computed from the catalogue, so a future
  permission is tried automatically.
- **`src/server/services/comments.integration.test.ts`**: one more test, in which an
  agent's token creates a comment through the route, and the comment's `author` is
  the agent's account. This is the attribution in the task data that doc 0003 section 9
  asks for.

### 4. The guide: `docs/agents.md`

For someone writing a program, not for an Opanel developer. It is short, with `bash`
examples using `curl`. Sections:

1. **What an agent is**: an account of its own, with a role, scopes and projects, acting
   only through `/api/v1`; Opanel runs no agents (doc 0001).
2. **Getting a token**: an Admin creates the agent and its token on the Agents page (or
   through `POST /api/v1/agents/{agentId}/tokens`). The token is shown once; store it as
   a secret.
3. **Sending it**: `Authorization: Bearer opk_…` on every request. No cookie, no `Origin`
   header needed, and the API sends no CORS headers (no calls from a browser page).
4. **What a token can do**: the five scopes and what each allows; the two roles; the
   project restriction (other projects are missing from lists and answer `403`).
5. **Knowing yourself: `GET /api/v1/me`**: the `AgentMe` fields; check `permissions` and
   `projectIds` at start.
6. **Errors and limits**:
   - problem details and `code`;
   - `401` for any bad token, with no reason given;
   - `403`, `404` and `409 version_conflict` with `current`;
   - `413` above 512 KiB;
   - `429 rate_limited` above 600 requests a minute per token, with `Retry-After`.
7. **Lists**: cursor pagination, `limit` up to 100, `nextCursor`.
8. **Live updates**: `GET /api/v1/projects/{projectId}/events` with the token (needs
   `tasks:read`); heartbeats every 25 seconds; reconnect and reload; a revoked token
   loses its stream at the next heartbeat.
9. **Rotating and revoking**: up to 10 usable tokens per agent, so you can create the new
   one, switch, then revoke the old one; tokens expire after their chosen period.
10. **The contract**: `GET /api/v1/openapi.json`, each operation's `x-opanel-permission`,
    and the versioning rule (doc 0004 section 8).
11. **What comes next**: bug reports with triage (WT-06) and the MCP server (WT-11), not
    available yet.

`README.md` gains one line linking it. The OpenAPI document's `info.description` gains
"Agent authors: see docs/agents.md in the repository." This is a documentation string,
not a contract change.

### 5. The guide check: shared with the operations guide

- `guideProblems` and its helpers move from `scripts/operations-guide.test.ts` to
  `scripts/doc-checks.ts`, unchanged, so both guides use one checker (open question 2).
- `scripts/agents-guide.test.ts` checks `docs/agents.md`:
  - every `METHOD /api/v1/…` it names matches a contract in `src/lib/openapi/contracts.ts`
    (with `{…}` path parameters, or an example value in their place);
  - every backticked word that is a problem code shape (`[a-z]+(_[a-z]+)+`) and appears in
    the errors section is in `PROBLEM_CODES`;
  - every scope it names is in `AGENT_SCOPES`;
  - its links resolve;
  - its section headings are those of section 4, in order;
  - `README.md` links it.

### 6. Closing WT-05

- WT-05's exit criteria are ticked, each with its item or test.
- WT-05 and its item H are `Done`.
- In `docs/README.md`, "Where the project stands" points to the next track, WT-06 (bug
  reports and automated triage), to be drafted.

## Files

| Path                                                                                        | Change                            |
| ------------------------------------------------------------------------------------------- | --------------------------------- |
| `tests/e2e/agent-flow.spec.ts`                                                              | create: section 2                 |
| `src/app/api/v1/agents/permissions.integration.test.ts`                                     | create: section 3                 |
| `src/server/services/comments.integration.test.ts`                                          | modify: one test (section 3)      |
| `docs/agents.md`                                                                            | create: section 4                 |
| `scripts/doc-checks.ts`, `scripts/operations-guide.test.ts`, `scripts/agents-guide.test.ts` | create, modify, create: section 5 |
| `src/lib/openapi/document.ts`, `docs/api/openapi.json`                                      | modify: one description sentence  |
| `README.md`                                                                                 | modify: one line                  |
| `docs/README.md`, WT-05, WI-078, WS-078                                                     | modify: statuses, exit criteria   |

## Data model changes

None.

## API contract

None. The OpenAPI document's `info.description` gains one sentence.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                              | Covers criterion |
| --- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | integration | section 3, permissions: every non-agent permission refused through `POST` and `PATCH`. Expected to pass at once, since it proves what exists; recorded either way | 2                |
| 2   | integration | section 3, attribution: an agent's comment through the route has the agent as author                                                                              | 3                |
| 3   | unit        | `agents-guide.test.ts` before the guide exists: fails on the missing file (red, recorded)                                                                         | 5                |
| 4   | unit        | the moved `guideProblems` still passes the operations guide's own tests, unchanged                                                                                | 5                |
| 5   | unit        | `agents-guide.test.ts` with the guide written: endpoints, codes, scopes, links, headings and the README link all check                                            | 4, 5             |
| 6   | e2e         | `agent-flow.spec.ts`, section 2                                                                                                                                   | 1                |
| 7   | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`                                                                                                           | 7                |

## Risks and open questions

For the owner:

1. **The stream-closing-on-revocation check stays at the integration level**, not
   repeated in the end-to-end test, which would wait up to 25 seconds for a heartbeat.
   **Recommend: as proposed.**
2. **Move `guideProblems` to a shared `scripts/doc-checks.ts`**, rather than copying it
   into a second test file. This is a small refactor of WS-070's test, with its tests
   unchanged. **Recommend: share it.**
3. **The guide uses `curl` examples only**, no language SDK. Opanel ships no client
   library, and the MCP server (WT-11) is the packaged client. **Recommend: as
   proposed.**
4. **Tests 1 and 2 may pass at once**, because they prove behaviour that already exists.
   They are exit-criterion tests, not new behaviour, so no code change is expected; if
   either fails, that is a bug, fixed in this item and recorded. **Recommend: as
   proposed.**

Risks:

- **The end-to-end test reads the token from the dialog**, like a person copying it. If
  the dialog changes, the test changes with it. That is the same coupling as
  `agents.spec.ts`.

## Deviations from the approved spec

1. **The attribution test is in the comments route's test**
   (`src/app/api/v1/tasks/[taskId]/comments/route.integration.test.ts`), not in
   `comments.integration.test.ts`, because it goes through the route with a token.
2. **The permissions test reads a field error by its field**, since Zod names the array
   element (`scopes.0`). The refusal itself is the expected `400`.

## Implementation record

- Tests 1 and 2 (permissions, attribution) passed once written, as question 4 expected:
  they prove behaviour that exists. The permissions test first failed on its own
  assertion (deviation 2), not on the API.
- Section 5: `guideProblems` and its helpers moved to `scripts/doc-checks.ts`; the
  operations guide's 9 tests pass unchanged.
- Red: `agents-guide.test.ts` failed 7 of 9 before `docs/agents.md` existed. Green:
  9 of 9 with the guide, the README line and the OpenAPI description. A mutated copy
  (an unknown endpoint, an unknown code, an unknown scope) failed on all three, then the
  guide was restored.
- `agent-flow.spec.ts` passed.
- WT-05's exit criteria are ticked, and WT-05 is `Done`.
- Gate on 2026-11-19:
  - typecheck, lint and Prettier pass;
  - Vitest 1546 of 1546;
  - `pnpm test:e2e` 87 of 87 with `--retries=0`;
  - Windows, Node 24, pnpm 10.28.0, Compose PostgreSQL on port 5433.
