# WS-076 — `GET /me` for agents

- Status: Proposed (must be `Approved` by the owner before any code is written)
- Work-item: [WI-076](../work-items/WI-076-me-for-agents.md)
- Canonical docs: [0005](../canonical/0005-mcp-server.md) (section 3: the MCP server reads
  `GET /me` at start); [0004](../canonical/0004-api-conventions.md) (section 7:
  authentication-only operations); [0001](../canonical/0001-ai-qa-agents-and-triage.md)
  (section 3: agent roles and scopes);
  [WT-05](../work-tracks/WT-05-agent-accounts-and-tokens.md) (decisions 1, 2, 7, 9);
  [WT-11](../work-tracks/WT-11-mcp-server.md) (item A: tools chosen by `GET /me`);
  [WS-072](WS-072-api-tokens.md) (section 4: the `session` access kind); AGENTS.md hard
  rule 9

## Approach

### 1. Where things stand (checked on 2026-11-19, `main` at `08a27f0`)

- `GET /api/v1/me` (`src/app/api/v1/me/route.ts`) has `authenticated` access, so it already
  accepts a token (WS-072). It answers `{ ...summarize(account), permissions }`, where
  `summarize` (`src/server/services/sign-in.ts`) gives `id`, `kind`, `name`, `email` and
  `role`. For an agent today that is `email: null`, `role: "qa_agent"` and its scopes, with
  no project restriction. Nothing documents it: `meResponseSchema` types `role` as any
  string and `email` as nullable.
- `PATCH /me` has `session` access (WS-072), so only humans reach it. It answers with the
  same `meResponseSchema`.
- The `Actor` already carries everything an agent body needs: `role` (`AgentRole`),
  `permissions` (exactly its stored scopes) and `projectIds` (`ReadonlySet<string> | null`),
  loaded by `authenticate()` through `loadAgentActor`. No new query is needed.
- `accounts_human_has_email_check` guarantees that a human row has an email.
- Consumers of `meResponseSchema` and of the `GET /me` body:
  - **UI:** none reads the body. `AccountMenu` calls `GET /me` once per page load only to
    refresh the session cookie and ignores the response. `ProfilePage` calls `PATCH /me` and
    reads only the status. The shell gets the account from the server as an
    `AccountSummary`, not from `/me`.
  - **Integration tests:** `me/route`, `setup/route` and `account-links/accept/route`
    parse bodies with `meResponseSchema`, then use `toMatchObject`, `.name` and
    `.permissions`, which every member of a union has.
  - **Unit:** `src/lib/schemas/auth.test.ts` parses a human fixture without `projectIds`.
  - **E2E:** `tests/e2e/auth.spec.ts` and `tests/e2e/setup.spec.ts` parse with
    `meResponseSchema` and `toMatchObject({ email, role })`.
  - **WT-11** (not built yet) will parse it in the MCP server.

### 2. The schemas: `src/lib/schemas/auth.ts`

Two members and their union, built with Zod's `discriminatedUnion` on `kind`:

```ts
const projectIdsDescription =
  "The projects the caller may reach, or null for all of them (WT-05 decision 7).";

export const humanMeSchema = z
  .strictObject({
    id: z.uuid(),
    kind: z.literal("human"),
    name: z.string(),
    email: z.string(),
    role: humanRoleSchema,
    permissions: z.array(permissionSchema),
    projectIds: z.null().meta({ description: projectIdsDescription }),
  })
  .meta({ id: "HumanMe" });

export const agentMeSchema = z
  .strictObject({
    id: z.uuid(),
    kind: z.literal("agent"),
    name: z.string(),
    role: agentRoleSchema,
    permissions: z.array(agentScopeSchema),
    projectIds: z.array(z.uuid()).nullable().meta({ description: projectIdsDescription }),
  })
  .meta({ id: "AgentMe" });

export const meResponseSchema = z
  .discriminatedUnion("kind", [humanMeSchema, agentMeSchema])
  .meta({ id: "Me" });

export type HumanMe = z.infer<typeof humanMeSchema>;
export type AgentMe = z.infer<typeof agentMeSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
```

- **Agents have no `email`** (open question 2), rather than `email: null`: the field means
  nothing for an agent, and a client that switches on `kind` never needs it.
- **Both `role` fields become enums**, and a human's `email` becomes non-null (open
  question 3). Both narrow what the API already sends, so no client breaks, and the
  document then says what a client can rely on.
- **Agent `permissions` use `agentScopeSchema`**, so the schema itself says that an agent
  never holds a `*:manage` or delete permission (WT-05 decision 1).
- **Humans gain `projectIds: null`**, an additive field (WT-05 decision 9). A client can
  read `projectIds` without first checking `kind`.
- `accountSummarySchema`, and the `setup` and `account-links/accept` responses built on
  it, do not change.

### 3. The handler: `src/app/api/v1/me/route.ts`

`me(actor, account)` returns `MeResponse`, chosen by `actor.kind`:

- human: `{ id, kind: "human", name, email, role: actor.role, permissions, projectIds: null }`;
- agent: `{ id, kind: "agent", name, role: actor.role, permissions, projectIds }`.

`permissions` is the actor's set, sorted, as today. `projectIds` is the actor's set,
sorted, or `null`. `id` and `name` come from the account row. Roles come from the actor,
which has already validated them, not from the row's `role` string. For a human, `email`
comes from the row; a `null` there throws (`500`), which the database check makes
impossible.

`PATCH /me` keeps calling `me()` and its contract answers `humanMeSchema`, since `session`
access admits only humans. The handler narrows the result with a one-line check on
`actor.kind`, so the types hold without a cast.

The `GET /me` description becomes: "Returns the caller's account, permissions and project
restriction. A person gets `kind: "human"` and an email; an agent gets `kind: "agent"`, its
agent role and scopes, and `projectIds` (null for all projects). Needs a session or an API
token, no permission."

### 4. The OpenAPI document

zod-openapi turns the union into `Me: { oneOf: [HumanMe, AgentMe] }`, each member a
component of its own. Whether version 6.0.2 also writes a `discriminator` object on `kind`
is read in its documentation for the installed version before coding (hard rule 13). If
it does, it is kept; if it needs an option, the option is set; if it cannot, `oneOf` alone
is correct, because `kind` is a `const` in each member. `docs/api/openapi.json` is
regenerated with `pnpm openapi:generate`.

### 5. Consumers

- **UI:** no change (section 1).
- **Tests that parse a human body:** unchanged. A human body parses as `HumanMe`, and
  `toMatchObject`, `.name` and `.permissions` type-check on the union. `tsc` finds any
  test that reads `.email` on the union directly; section 1's search found none.
- **`auth.test.ts`:** its fixture gains `projectIds: null`, and the cases of test 1 below.
- **WT-11:** parses with `meResponseSchema` and switches on `kind` (doc 0005 section 3:
  it stops when the account is not an agent).

### Considered and not chosen

- **One flat schema, adding `projectIds`.** Smallest change, but the document would keep
  saying that any account may have an email, any role string and any permission, which
  is exactly what an agent author must not assume.
- **A separate `GET /me` contract for agents** (say `/agents/me`): two endpoints for one
  question, and WT-11 and doc 0005 already name `GET /me`.
- **Adding the agent's `description`, or its tokens' expiry:** WT-11 needs neither. The
  description is part of the Admin API (item C); a token's expiry would put token
  metadata in a response that need not have any.

## Files

| Path                                                         | Change                                             |
| ------------------------------------------------------------ | -------------------------------------------------- |
| `src/lib/schemas/auth.ts` (+ `auth.test.ts`)                 | modify: section 2, `meContract` description        |
| `src/app/api/v1/me/route.ts` (+ `route.integration.test.ts`) | modify: section 3                                  |
| `src/lib/openapi/document.test.ts`                           | modify: the `Me` union and `PATCH /me`'s `HumanMe` |
| `docs/api/openapi.json`                                      | regenerate                                         |
| `docs/README.md`, WT-05, WI-076, WS-076                      | modify: statuses                                   |

No canonical doc changes: doc 0005 already says the MCP server reads `kind` and
`permissions` from `GET /me`, and this item adds `projectIds` to that.

## Data model changes

None.

## API contract

- `GET /api/v1/me`, `200`: `Me`, one of
  - `HumanMe`: `id`, `kind: "human"`, `name`, `email`, `role` (`viewer` | `member` |
    `manager` | `admin`), `permissions`, `projectIds: null`;
  - `AgentMe`: `id`, `kind: "agent"`, `name`, `role` (`qa_agent` | `worker_agent`),
    `permissions` (agent scopes), `projectIds` (array of project ids, or `null`).
- `PATCH /api/v1/me`, `200`: `HumanMe`.
- Access, status codes and permissions are unchanged: `GET /me` needs a session or a
  token, `PATCH /me` a session (`403` to a token), `401` without either.
- For humans the change is additive (`projectIds`) or narrows a type the API already
  sent. For agents `email: null` goes away: tokens first worked in WI-072, on the same
  day, and no client or release uses them yet (open question 2).

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                                                                                                                                                                                                                 | Covers criterion |
| --- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit        | `meResponseSchema`: a human body with `projectIds: null` parses as `kind: "human"`; an agent body parses with `projectIds: null` and with an array of ids. Refused: a human without `email` or with `projectIds: []`; a human with role `qa_agent`; an agent with `email`, with role `admin`, with permission `accounts:manage`; a body with `kind: "robot"` or none | 4                |
| 2   | integration | `GET /me` with a token (`createTestAgent` with all projects, `createTestToken`, `bearerRequest`): `200`, `no-store`, and the body equals exactly `{ id, kind: "agent", name, role, permissions, projectIds: null }`, with no `email` key                                                                                                                             | 1                |
| 3   | integration | `GET /me` with a token of a `worker_agent` restricted to two projects, holding fewer scopes than its role: `projectIds` is those two ids sorted, `permissions` is exactly the stored scopes sorted; two calls give the same body                                                                                                                                     | 1, 2             |
| 4   | integration | `GET /me` and `PATCH /me` with a session: the bodies of today plus `projectIds: null`, parsed with `humanMeSchema` (the existing tests, extended)                                                                                                                                                                                                                    | 3                |
| 5   | unit        | the OpenAPI document: `Me` is `oneOf` the `HumanMe` and `AgentMe` components; `GET /me`'s `200` refers to `Me` and `PATCH /me`'s to `HumanMe`; the committed `openapi.json` matches (existing check)                                                                                                                                                                 | 5                |
| 6   | gate        | `typecheck` (every consumer of the union), `lint`, `format:check`, `test`, `test:e2e` (the `auth` and `setup` specs parse human bodies)                                                                                                                                                                                                                              | 6                |

No new E2E test: the end-to-end agent flow is item H, which needs the Admin API (item C)
to create a token through the UI.

## Risks and open questions

For the owner:

1. **A discriminated union for `Me`**, rather than one flat schema with `projectIds` added.
   The union keeps the document generated (hard rule 9) and tells agent authors exactly
   what they get. The cost is that TypeScript consumers narrow on `kind` before reading
   `email`; today none does. **Recommend: the union.**
2. **No `email` key for agents**, rather than `email: null` as `GET /me` has sent to tokens
   since WI-072. Removing a response field is breaking in general, but no client and no
   release has used agent tokens yet. **Recommend: no `email` for agents.**
3. **Narrow the human body while here:** `role` to the four human roles and `email` to
   non-null, both already true of every response. **Recommend: narrow them.** The
   alternative is to keep `role: string` and `email: string | null` on `HumanMe`, which
   changes nothing for humans except `projectIds`.
4. **`PATCH /me` answers `HumanMe`**, not `Me`, since only a session reaches it. **Recommend:
   `HumanMe`.**

Risks:

- **Parallel item C (WI-075)** adds agent schemas and contracts and regenerates
  `docs/api/openapi.json`. Whichever merges second regenerates it again; the expected
  overlap is that file, `docs/README.md` and the WT-05 table. If item C also adds a
  schema named `Agent…Me` or reuses `agentMeSchema`'s field set, the two are aligned at
  rebase.
- **zod-openapi's output for a discriminated union** (section 4) is checked before coding;
  test 5 fixes whatever it produces.
