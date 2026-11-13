# WS-026 — Teams, membership and the people directory

- Status: Proposed (must be `Approved` by the owner before any code is written)
- Work-item: [WI-026](../work-items/WI-026-teams-and-people.md)
- Canonical docs: [0003](../canonical/0003-task-management.md) sections 2, 3;
  [0004](../canonical/0004-api-conventions.md) sections 5, 6, 7;
  [0001](../canonical/0001-ai-qa-agents-and-triage.md) sections 3, 7;
  [WT-03](../work-tracks/WT-03-board-core.md) decisions 9, 16, 17

## Approach

### 1. Who is a "person"

A **person** is a human account that has chosen a password: invited accounts that never
accepted are not people yet, and agents never are. A person is **active** when not
deactivated. This is the definition `listAccounts` already uses for the `invited` and
`deactivated` states (`has_password`, `disabled_at`), written once as an SQL fragment in
`src/server/services/people.ts` and reused by teams.

### 2. Data model

```
teams         id uuid pk, name text not null, created_by uuid → accounts (set null),
              created_at, updated_at
              unique index teams_name_lower_idx on lower(name)
team_members  team_id uuid → teams (cascade), account_id uuid → accounts (restrict),
              created_at; primary key (team_id, account_id)
              index team_members_account_idx on (account_id)
```

Case-insensitive uniqueness ("Frontend" and "frontend" are the same team) is a unique index
on `lower(name)`, so it holds under concurrent creation. Accounts are never deleted, so
`restrict` on `account_id` only guards against a mistake. Deleting a team deletes its
memberships.

### 3. Names

A team name is trimmed and must be 1 to 100 characters after trimming: the account name
rule (`accountNameSchema`), reused.

### 4. Keyset pagination by name

Doc 0004 section 5 describes cursors carrying the last row's creation time. People and teams
are listed by name, so the cursor carries the name instead. `src/server/http/pagination.ts`
gains a second cursor kind beside the existing one:

```ts
export interface NameCursor { name: string; id: string }
encodeNameCursor(cursor): string;   // base64url of { n, i }
decodeNameCursor(value): NameCursor; // 400 with field "cursor" if not one of ours
```

Queries order by `(name, id)` and continue with `(name, id) > ($name, $id)`, both under the
database's default collation, so the order and the comparison always agree. Names are at most 100
characters, so cursors stay short. Doc 0004 section 5 is updated to say a cursor carries the last row's sort key, with
creation time as the default. Ordering positions (WI-027) uses its own collation and is
unaffected.

### 5. Endpoints

All take and return JSON per doc 0004. Access is declared in each contract (WS-025).

| Operation                                           | Access          | Success | Specific errors                                                 |
| --------------------------------------------------- | --------------- | ------- | --------------------------------------------------------------- |
| `GET /api/v1/people`                                | `projects:read` | `200`   | `400` query                                                     |
| `GET /api/v1/teams`                                 | `projects:read` | `200`   | `400` query                                                     |
| `POST /api/v1/teams`                                | `teams:manage`  | `201`   | `400`, `409 team_name_taken`, `415`                             |
| `GET /api/v1/teams/{teamId}`                        | `projects:read` | `200`   | `400`, `404`                                                    |
| `PATCH /api/v1/teams/{teamId}`                      | `teams:manage`  | `200`   | `400`, `404`, `409 team_name_taken`, `415`                      |
| `DELETE /api/v1/teams/{teamId}`                     | `teams:manage`  | `204`   | `400`, `404`                                                    |
| `POST /api/v1/teams/{teamId}/members`               | `teams:manage`  | `200`   | `400` (not a person), `404` team, `409 account_inactive`, `415` |
| `DELETE /api/v1/teams/{teamId}/members/{accountId}` | `teams:manage`  | `204`   | `400`, `404` (no such team or not a member)                     |

Schemas, in `src/lib/schemas/teams.ts` and `src/lib/schemas/people.ts`:

```ts
person         = { id: uuid, name: string, active: boolean }            // "Person"
peopleQuery    = paginationQuery & { q?: string 1..100 }                  // strict
teamSummary    = { id, name, memberCount: int, createdAt }               // "TeamSummary"
team           = { id, name, members: person[], createdAt, updatedAt }   // "Team"
createTeam     = { name }                                                // strict
updateTeam     = { name }                                                // strict
addMember      = { accountId: uuid }                                     // strict
```

- **People** are ordered by name, then id. `q` matches the start of the name, ignoring
  case (`name ilike q || '%'`, with `%`, `_` and `\` in `q` escaped). Inactive people are
  included with `active: false` (WT-03 decision 17).
- **Teams** are ordered by name, then id. `memberCount` counts all members, active or not.
- **A team's members** are returned whole, ordered by name, inside the team (doc 0004
  section 5 allows a naturally bounded collection to be returned whole; a team is a group
  of people, not an open-ended list). If teams grow past a few hundred members this
  becomes its own paginated endpoint, which is additive.
- **Adding a member** returns the team. Adding someone who is already a member succeeds
  and changes nothing, with no audit entry, so a double click is harmless. An `accountId`
  that is not a person (unknown, an agent, an invited account) is a `400` with the field
  error `accountId`; a deactivated person is `409 account_inactive`.
- **Removing a member** who is not one is a `404`, like any missing resource.
- `PATCH` with the team's current name returns `200` and writes no audit entry.

Teams have no `version` (WT-03 decision 7): rename and membership are last-write-wins.

New problem codes in `PROBLEM_CODES`: `team_name_taken` and `account_inactive`, both `409`.

### 6. Deleting a team

Decision 9 forbids deleting a team that a task is assigned to. Tasks do not exist until
WI-030, so in this item deletion always succeeds when the team exists. WI-030 adds the
foreign key `tasks.assignee_team_id → teams` with `on delete restrict` and maps its
violation to `409 team_in_use`; that check belongs with the table that creates the
reference. This is recorded in WI-030's row of WT-03 so it is not forgotten.

### 7. Services and audit

`src/server/services/people.ts` (`listPeople`) and `src/server/services/teams.ts`
(`listTeams`, `getTeam`, `createTeam`, `renameTeam`, `deleteTeam`, `addTeamMember`,
`removeTeamMember`). Each takes the `Actor` first and calls `requirePermission` itself, as
the account services do, so a service is safe whatever calls it. Writes run in one
transaction with their audit entry (WT-03 decision 16):

| Action                | Entity / id      | `data`                  |
| --------------------- | ---------------- | ----------------------- |
| `team.created`        | `team` / team id | `{ name }`              |
| `team.renamed`        | `team` / team id | `{ from, to }`          |
| `team.deleted`        | `team` / team id | `{ name, memberCount }` |
| `team.member_added`   | `team` / team id | `{ accountId }`         |
| `team.member_removed` | `team` / team id | `{ accountId }`         |

The five actions are added to `AUDIT_ACTIONS`. A unique-violation on
`teams_name_lower_idx` is turned into `409 team_name_taken`, so two concurrent creations
of the same name give one `201` and one `409`.

### 8. Doc changes

- Doc 0004 section 5: cursors carry the last row's sort key (creation time by default,
  name for people and teams).
- Doc 0001 section 3 already lists people under `projects:read` (WT-03 decision 17).

## Files

| Path                                                         | Change                              |
| ------------------------------------------------------------ | ----------------------------------- |
| `src/server/db/schema/teams.ts`, `index.ts`                  | create, modify                      |
| `src/server/db/migrations/0006_teams.sql` (+ `meta`)         | create (`pnpm db:generate`)         |
| `src/server/http/pagination.ts`, `pagination.test.ts`        | modify: name cursor                 |
| `src/lib/schemas/people.ts`, `teams.ts` (+ `.test.ts`)       | create: schemas and contracts       |
| `src/lib/schemas/problem.ts`, `src/lib/schemas/audit.ts`     | modify: two codes, five actions     |
| `src/lib/openapi/contracts.ts`                               | modify: eight contracts             |
| `src/server/services/people.ts`, `teams.ts` (+ tests)        | create                              |
| `src/app/api/v1/people/route.ts`                             | create                              |
| `src/app/api/v1/teams/route.ts`                              | create                              |
| `src/app/api/v1/teams/[teamId]/route.ts`                     | create                              |
| `src/app/api/v1/teams/[teamId]/members/route.ts`             | create                              |
| `src/app/api/v1/teams/[teamId]/members/[accountId]/route.ts` | create                              |
| route integration tests next to each route                   | create                              |
| `src/lib/openapi/routes.test.ts`                             | none (the public list is unchanged) |
| `docs/api/openapi.json`                                      | regenerate                          |
| `docs/canonical/0004-api-conventions.md`                     | modify: section 5                   |
| `docs/README.md`, WI-026, WS-026, WT-03                      | modify: statuses                    |

No new dependency.

## Data model changes

Migration `0006_teams`: tables `teams` and `team_members` as in section 2, with
`teams_name_lower_idx` (unique, on `lower(name)`) and `team_members_account_idx`. The
expression index is written in the Drizzle schema with `uniqueIndex(...).on(sql\`lower(...)\`)`so`pnpm db:generate` produces it and leaves no diff.

## API contract

Section 5. All additive (doc 0004 section 8). The OpenAPI document gains eight operations,
the schemas `Person`, `PersonPage`, `TeamSummary`, `TeamPage` and `Team`, and the
permission of each operation through `x-opanel-permission`.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                         | Covers criterion     |
| --- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| 1   | unit        | name cursor: round trip; a creation-time cursor, garbage or a wrong shape is `400` with field `cursor`                                       | pagination           |
| 2   | unit        | schemas: names trimmed, 1..100; unknown fields rejected; `q` 1..100; `accountId` must be a UUID                                              | validation           |
| 3   | unit        | contracts: access of each of the eight operations is exactly as in section 5                                                                 | permissions          |
| 4   | integration | `listPeople`: people only (no invited, no agent), ordered by name then id, `active` from `disabled_at`, no other fields; pages join up       | directory            |
| 5   | integration | `listPeople` with `q`: case-insensitive prefix; `%` and `_` in `q` match literally                                                           | directory            |
| 6   | integration | `createTeam`: row and `team.created` audit entry; "Frontend" then "frontend" is `team_name_taken`; two concurrent creations give one of each | unique names, audit  |
| 7   | integration | `renameTeam`: renamed with audit `{ from, to }`; same name writes no audit; taken name is `409`; unknown team is `404`                       | audit                |
| 8   | integration | `addTeamMember`: adds with audit; again is a no-op with no audit; invited, agent or unknown is `400`; deactivated is `409 account_inactive`  | membership           |
| 9   | integration | `removeTeamMember`: removes with audit; not a member is `404`; a member deactivated later is listed with `active: false`                     | membership           |
| 10  | integration | `deleteTeam`: team and memberships gone, audit with name and member count; unknown team `404`                                                | delete               |
| 11  | integration | a failing audit write rolls back each of the five writes (`failAuditFor`)                                                                    | audit in transaction |
| 12  | integration | routes: each operation's success status and body; `listTeams` `memberCount`; `getTeam` members ordered by name                               | endpoints            |
| 13  | integration | routes: Viewer and Member get `403` on the five writes and `200` on the three reads; no session is `401` everywhere                          | permissions          |
| 14  | integration | routes: the people directory body never contains an email, role or status field                                                              | no data leak         |
| 15  | integration | migration: `pnpm db:generate` leaves no diff (existing check)                                                                                | migration            |

## Risks and open questions

1. **Members of a team are returned whole.** Proposed for simplicity; if the owner prefers,
   `GET /api/v1/teams/{teamId}/members` can be paginated from the start instead.
2. **Adding an existing member is a silent success** rather than a `409`. Proposed because
   the operation's intent ("this person is in the team") is already true.
3. **Team deletion is unrestricted until WI-030** (section 6). There is no task to lose in
   between, so nothing can be orphaned.
