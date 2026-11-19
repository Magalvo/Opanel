# WS-071 — Agent accounts in the data model, and the agent `Actor`

- Status: Approved (by the owner on 2026-11-19, questions 1 to 5 as proposed)
- Work-item: [WI-071](../work-items/WI-071-agent-data-model.md)
- Canonical docs: [0001](../canonical/0001-ai-qa-agents-and-triage.md) (sections 3, 4
  and 7; amended here); [WT-05](../work-tracks/WT-05-agent-accounts-and-tokens.md)
  (decisions 1 to 3, 7, 11; questions 1 and 2); [0006](../canonical/0006-operations.md)
  section 5 and [WS-063](WS-063-database-roles.md) (the runtime role's rights);
  `AGENTS.md` hard rule 5

## Approach

### 1. Where things stand (checked on 2026-11-19, `main` at `350ad03`)

- `accounts` has `kind` (`human` | `agent`, checked), a nullable unique `email`, a
  not-null `role`, `disabled_at`, `last_seen_at`, `created_by`. Only human rows are
  checked for a role (`accounts_human_role_check`) and an email
  (`accounts_human_has_email_check`). No agent row exists anywhere.
- Every query that lists or changes human accounts already filters `kind = 'human'`
  (`account-management.ts`), and people, assignment and team membership use `isPerson`.
- `account_tokens` already exists: the one-time invitation and reset links. The API
  tokens get their own table, `api_tokens`, as doc 0001 section 7 names it.
- `Actor` is one interface with `kind: "human"` and `role: HumanRole`. `Actor["role"]` is
  used as a cast in four places (`authenticate.ts`, `accept-link.ts`, `setup.ts`,
  `sign-in.ts`); no code reads `actor.role` to decide anything.
- Migrations end at `0015`. New tables get the runtime role's rights by default
  privileges (migration 0014), and the WS-063 test checks every table.
- Projects are archived, never deleted (no delete path in `projects.ts`).

### 2. The migration, `0016_agents`

Generated with `pnpm db:generate` from the schema changes below, then completed by hand
where drizzle-kit cannot express the rule (marked "hand").

**`accounts`**

- New column `description text`, nullable.
- New column `all_projects boolean`, nullable (decision 7; open question 2).
- New unique index `accounts_id_kind_idx` on `(id, kind)`: the target of the composite
  foreign keys below (open question 1).
- Checks:
  - `accounts_agent_role_check`: `kind <> 'agent' or role in ('qa_agent', 'worker_agent')`;
  - `accounts_agent_no_email_check`: `kind <> 'agent' or email is null`;
  - `accounts_agent_fields_check`: for humans `description is null and all_projects is
null`; for agents `all_projects is not null`;
  - `accounts_description_length_check`: `description is null or char_length(description)
between 1 and 500`.
- Partial unique index `accounts_agent_name_lower_idx` on `lower(name) where kind =
'agent'` (decision 2). Humans are not affected.

**`agent_scopes`** (`account_id`, `account_kind`, `scope`), primary key
`(account_id, scope)`:

- `account_kind text not null default 'agent'`, checked `= 'agent'`, and the foreign key
  `(account_id, account_kind) → accounts (id, kind)` on delete cascade. A scope can then
  belong only to an agent, declaratively, with no trigger.
- `agent_scopes_scope_check`: `scope in ('projects:read', 'tasks:read', 'reports:write',
'comments:write', 'tasks:write')`. No `*:manage` or delete permission can be stored
  (decision 1).

**`agent_projects`** (`account_id`, `account_kind`, `project_id`), primary key
`(account_id, project_id)`: the same agent-only foreign key; `project_id → projects(id)` on
delete cascade; index on `project_id`.

**`api_tokens`**:

| Column         | Type          | Rule                                                                   |
| -------------- | ------------- | ---------------------------------------------------------------------- |
| `id`           | `uuid`        | primary key, random default                                            |
| `account_id`   | `uuid`        | with `account_kind`, the agent-only foreign key; on delete cascade     |
| `account_kind` | `text`        | `'agent'`, checked                                                     |
| `public_id`    | `text`        | unique; check `public_id ~ '^[a-z2-7]{12}$'` (hand)                    |
| `secret_hash`  | `text`        | SHA-256 of the secret as 64 hex characters; check `~ '^[0-9a-f]{64}$'` |
| `name`         | `text`        | check `char_length(name) between 1 and 80`                             |
| `created_by`   | `uuid`        | → `accounts(id)` on delete set null (the Admin)                        |
| `created_at`   | `timestamptz` | default `now()`                                                        |
| `expires_at`   | `timestamptz` | nullable: no expiry (WT-05 question 3)                                 |
| `revoked_at`   | `timestamptz` | nullable                                                               |
| `last_used_at` | `timestamptz` | nullable                                                               |

Index on `account_id`. Revoked and expired tokens are kept (open question 4). The secret's
hash is stored as hex text, like `account_tokens.token_hash`.

No table is append-only. Default privileges give `opanel_app` its rights; the migration
grants nothing itself.

### 3. Drizzle schema

- `src/server/db/schema/accounts.ts`: the two columns, the checks, the two indexes. The
  comment "Agent roles are added by WT-05" goes.
- `src/server/db/schema/agents.ts`: `agentScopes`, `agentProjects`.
- `src/server/db/schema/api-tokens.ts`: `apiTokens`.
- `src/server/db/schema/index.ts` exports them.

### 4. Catalogue, roles and `Actor`

`src/lib/schemas/permissions.ts`:

```ts
export const AGENT_SCOPES = [
  "projects:read",
  "tasks:read",
  "reports:write",
  "comments:write",
  "tasks:write",
] as const satisfies readonly Permission[];
export const agentScopeSchema = z.enum(AGENT_SCOPES);
export const AGENT_ROLES = ["qa_agent", "worker_agent"] as const;
export const agentRoleSchema = z.enum(AGENT_ROLES);
```

`src/server/auth/roles.ts`: `AGENT_ROLE_SCOPES` (`qa_agent`: the four of doc 0001;
`worker_agent`: those and `tasks:write`) and `scopesForAgentRole(role: unknown)`, which
throws for anything that is not an agent role, like `permissionsForRole`.

`src/server/auth/actor.ts`:

```ts
export interface HumanActor {
  readonly kind: "human";
  readonly accountId: string;
  readonly role: HumanRole;
  readonly permissions: ReadonlySet<Permission>;
  readonly projectIds: null;
}
export interface AgentActor {
  readonly kind: "agent";
  readonly accountId: string;
  readonly role: AgentRole;
  readonly permissions: ReadonlySet<Permission>; // exactly its scopes
  readonly projectIds: ReadonlySet<string> | null; // null: all projects
}
export type Actor = HumanActor | AgentActor;
```

- `humanActor` returns a `HumanActor` with `projectIds: null`; nothing else changes.
- `agentActor({ accountId, role, scopes, projectIds })` parses `role` and each scope with
  the schemas, and throws when a scope is not in `scopesForAgentRole(role)` (decision 1):
  a bad stored value never becomes a permission.
- `can`, `requirePermission` and `canDeleteTask` are unchanged; they read `permissions`.
- The four `as Actor["role"]` casts become `as HumanRole`.

### 5. `loadAgentActor`

`src/server/services/agents.ts`, the first function of the agents service:
`loadAgentActor(db, accountId): Promise<{ actor: AgentActor; disabledAt: Date | null } |
null>`. One query: the account row where `kind = 'agent'`, its scopes and its project ids
(`array_agg`), or `null`. It does not judge `disabledAt`: `authenticate()` does that in
item B, as it does for humans. Item B is its only caller.

### 6. Test helper

`src/server/auth/testing.ts` gains `createTestAgent({ name?, role?, scopes?, projectIds? })`,
which inserts the rows directly (the API to create agents is item C).

### 7. Doc 0001 amendment

- Section 3, "Agent account": the role is the preset the scopes start from; an Admin may
  remove scopes, never add one the role lacks; endpoints check the stored scopes. An
  agent may be restricted to listed projects, or have all projects. "created, disabled
  and deleted" becomes "created, disabled and re-enabled"; agents are not deleted in v1,
  since tasks, history and the audit log keep pointing at them.
- Section 7: `accounts` gains `description?` and `all_projects?`; `agent_scopes` and
  `agent_projects` are agent-only; `api_tokens` gains `name`, `created_by`, `created_at`.
- Header: "Amended by … WT-05 decisions 1 and 11 (applied 2026-11-19, WI-071)".

## Files

| Path                                                          | Change                                       |
| ------------------------------------------------------------- | -------------------------------------------- |
| `src/server/db/schema/accounts.ts`                            | modify: columns, checks, indexes (section 2) |
| `src/server/db/schema/agents.ts` (+ integration test)         | create                                       |
| `src/server/db/schema/api-tokens.ts` (+ integration test)     | create                                       |
| `src/server/db/schema/index.ts`                               | modify: exports                              |
| `src/server/db/migrations/0016_agents.sql`, `meta/*`          | create: generated, completed by hand         |
| `src/server/db/schema/accounts.integration.test.ts`           | modify: the agent row rules                  |
| `src/lib/schemas/permissions.ts` (+ test)                     | modify: agent scopes and roles               |
| `src/server/auth/roles.ts` (+ test)                           | modify: agent role scopes                    |
| `src/server/auth/actor.ts` (+ test)                           | modify: the union, `agentActor`              |
| `authenticate.ts`, `accept-link.ts`, `setup.ts`, `sign-in.ts` | modify: the cast only                        |
| `src/server/services/agents.ts` (+ integration test)          | create: `loadAgentActor`                     |
| `src/server/auth/testing.ts`                                  | modify: `createTestAgent`                    |
| `docs/canonical/0001-ai-qa-agents-and-triage.md`              | modify: section 7 of this spec               |
| `docs/README.md`, WT-05, WI-071, WS-071                       | modify: statuses                             |

## Data model changes

Migration `0016_agents`, section 2: two columns, four checks and two indexes on
`accounts`; three new tables. Existing rows are unaffected: every existing account is
human, and the new checks hold for them (`description` and `all_projects` are null).

## API contract

None. `Actor` is internal; no response changes.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                                                                                  | Covers criterion |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit        | `AGENT_SCOPES` is the five of doc 0001; none ends in `:manage` or starts with `tasks:delete`; each is in `PERMISSIONS`                                                                                                                | 2                |
| 2   | unit        | `scopesForAgentRole`: `qa_agent` the four, `worker_agent` the five; throws for `admin` and for an unknown value                                                                                                                       | 5                |
| 3   | unit        | `agentActor`: permissions are exactly the given scopes; `projectIds` kept, `null` kept; throws for a scope outside the role, or not an agent scope                                                                                    | 5                |
| 4   | unit        | `humanActor` has `projectIds: null`; `can` and `requirePermission` work for both kinds                                                                                                                                                | 5                |
| 5   | integration | `accounts`: an agent with role `admin`, with an email, or with `all_projects` null is refused; a human with a description is refused; two agents named `Bot` and `bot` are refused; a human and an agent both named `Bot` are allowed | 1, 4             |
| 6   | integration | `agent_scopes`: `agents:manage` is refused; a scope row for a human account is refused (foreign key); deleting the agent removes its rows                                                                                             | 2                |
| 7   | integration | `agent_projects`: a row for a human is refused; `api_tokens`: a row for a human, a `public_id` of the wrong shape, a duplicate `public_id`, a `secret_hash` that is not 64 hex characters, are refused                                | 2, 3             |
| 8   | integration | `loadAgentActor`: an agent restricted to two projects; an agent restricted to none (empty set, not `null`); an agent with all projects (`null`); a human id and an unknown id give `null`                                             | 4, 6             |
| 9   | integration | the WS-063 runtime-role test passes with the three new tables (no change to the test expected)                                                                                                                                        | 7                |
| 10  | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; the schema check of WS-064 accepts the new migration                                                                                                                         | 8                |

## Risks and open questions

For the owner:

1. **Agent-only child rows by a composite foreign key** `(account_id, account_kind) →
accounts(id, kind)`, with `account_kind` fixed to `'agent'`, rather than a trigger or
   only the service. Declarative, checked by PostgreSQL on every write; costs one unique
   index on `accounts (id, kind)` and one constant column per child table.
   **Recommend: the composite key.**
2. **An explicit `all_projects` flag** on agent rows, rather than "no `agent_projects`
   rows means all projects". Without it, an agent restricted to one project would gain
   every project the day that project's row went away; projects are not deleted today,
   but nothing in the schema would say so. **Recommend: the flag.**
3. **`secret_hash` as hex text**, like `account_tokens.token_hash`, rather than `bytea`.
   **Recommend: hex text, for consistency.**
4. **Revoked and expired tokens are kept**, so an agent's page can list them and the audit
   log's token ids stay resolvable; `maintenance` (doc 0006 section 8) is unchanged. They
   are a few rows per agent. **Recommend: keep them.**
5. **`loadAgentActor` in this item**, though only item B calls it, so the actor built from
   real rows is tested where the rows are defined. **Recommend: as proposed.**

Risks:

- Turning `Actor` into a union could break code that assumes `role` is a `HumanRole`; the
  search in section 1 found only the four casts, and `tsc` checks the rest.
- The new checks on `accounts` must hold for every existing row: they do, since all rows
  are human with the new columns null; the migration is tested against a database built by
  the earlier ones (WS-063, WS-064).
