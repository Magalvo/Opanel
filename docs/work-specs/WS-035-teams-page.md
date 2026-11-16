# WS-035 — Teams page

- Status: Proposed (must be `Approved` by the owner before any code is written)
- Work-item: [WI-035](../work-items/WI-035-teams-page.md)
- Canonical docs: [0003](../canonical/0003-task-management.md) section 3 ("Manage teams and
  team membership": Manager and Admin; reading: every role);
  [0004](../canonical/0004-api-conventions.md) sections 4 and 5;
  [WT-03](../work-tracks/WT-03-board-core.md) decisions 9 and 17; [WS-026](WS-026-teams-and-people.md)
  (the API), [WS-020](WS-020-people-page.md) (the pattern this page follows)

## Approach

### 1. Access

- **Who sees it.** Reading teams is `projects:read`, which every human role has, so the
  sidebar shows "Teams" (`/teams`, a `UsersRoundIcon`) to everyone (question 1). The
  existing "People" link stays Admin-only.
- **Who changes it.** Each teams page's server component computes
  `canManageTeams = can(actor, "teams:manage")` and passes it to its client component, so
  the shell does not change. Without it the pages render read-only: no buttons, no dialogs.
  The API stays the guard: a hidden control is a courtesy, `403` is the rule.
- **Pages** are server components that call `requireAccount()`; the data is read by the
  browser through the API, as the People page does (WS-020).

### 2. Two pages (question 2)

**`/teams`** (`src/app/(app)/teams/page.tsx` → `TeamsPage`)

- A `<table>`: team name (a link to its page) and member count. Ordered by name, as the
  API returns them. "Load more" while `nextCursor` is not null (page size 50).
- An empty state: "No teams yet." and, for managers, the create button.
- **New team** (managers): a dialog with a name field, validated in the browser with
  `createTeamRequestSchema`; `409 team_name_taken` is shown at the field ("Another team has
  this name."). On `201` the browser goes to the new team's page.

**`/teams/[teamId]`** (`src/app/(app)/teams/[teamId]/page.tsx` → `TeamPage`)

- A path that is not a UUID is `notFound()` on the server. A UUID the API answers `404` for
  (never existed, or deleted by someone else since) shows "This team does not exist." with a
  link back to `/teams`.
- Heading with the team's name; a members table: name and, for a deactivated person, a
  "Deactivated" badge (the API includes them, decision 17).
- **Rename** (managers): a dialog with the name prefilled; same validation and `409` as
  creating. Sending the current name is fine (the API answers `200`).
- **Add member** (managers): a dialog with a search field that queries
  `GET /api/v1/people?q=…` as the person types (debounced, 250 ms), lists matching active
  people who are not already members as buttons, and adds the one chosen with
  `POST /api/v1/teams/{teamId}/members`. The table updates from the response. A
  `409 account_inactive` (the person was deactivated meanwhile) says so in plain words.
- **Remove member** (managers): a button per row ("Remove Ada from Frontend"), with no
  confirmation, because adding back is one step (question 3). The row leaves on `204`.
- **Delete team** (managers): an alert dialog: "Delete Frontend? Its members stay; only the
  team goes." On `204` the browser goes to `/teams`. On `409 team_in_use` the dialog closes
  and the status message says: "Tasks are assigned to this team. Assign them elsewhere
  before deleting it." The team stays.
- One status region (`role="status"`) per page announces every outcome, as on People.

### 3. Shared API client (question 4)

`src/components/people/api.ts` holds `ApiFailure` and the small `call` and `jsonBody`
helpers. They move, unchanged, to `src/lib/api-client.ts`; `people/api.ts` imports them, and
`src/components/teams/api.ts` uses them for the team and people calls. Every response is
parsed with the shared Zod schemas of `src/lib/schemas/teams.ts`, `people.ts` and
`problem.ts`. The People tests cover the move: they must pass unchanged.

### 4. The delete-team contract (question 5)

`DELETE /api/v1/teams/{teamId}` already answers `409 team_in_use` when a task is assigned to
the team (WT-03 decision 9, built in WI-030, `src/server/services/teams.ts`), but
`deleteTeamContract` does not list it, so the OpenAPI document omits it. Under hard rule 11
this is raised here: the proposal is to add the response to the contract
(`409: { description: "Tasks are assigned to this team (code \`team_in_use\`).", problem:
true }`) and regenerate `docs/api/openapi.json`. Documentation of existing behaviour only,
no behaviour change, so no new API version (hard rule 9). A contract test asserts it.

### 5. Components

All in `src/components/teams/`, client components, built from the existing
`src/components/ui/` pieces (`table`, `dialog`, `alert-dialog`, `badge`, `button`, `input`).
**No new UI component and no new dependency.** The person picker is a plain list of buttons
under a labelled search field, not a combobox, which keeps it accessible without new code.

### 6. Out of scope

Live updates (WT-04); assigning tasks to teams (WI-038); the project's fallback triage team
and routing rules (WT-06); a team's description or avatar (not in doc 0003).

## Files

| Path                                                                      | Change                              |
| ------------------------------------------------------------------------- | ----------------------------------- |
| `src/app/(app)/teams/page.tsx`, `[teamId]/page.tsx` (+ integration tests) | create (tests first)                |
| `src/components/teams/*.tsx`, `api.ts` (+ `*.test.tsx`)                   | create (tests first)                |
| `src/lib/api-client.ts`                                                   | create: moved from `people/api.ts`  |
| `src/components/people/api.ts`                                            | modify: import the moved helpers    |
| `src/components/app-shell/app-sidebar.tsx` (+ test)                       | modify: the Teams link              |
| `src/lib/schemas/teams.ts`, `teams.test.ts`                               | modify: `409` on delete             |
| `docs/api/openapi.json`                                                   | regenerate                          |
| `tests/e2e/teams.spec.ts`; `tests/e2e/accessibility.spec.ts`              | create; modify: the two teams pages |
| `docs/README.md`, WT-03, WI-035, WS-035                                   | modify: statuses                    |

No migration, no new dependency, no new endpoint.

## Data model changes

None.

## API contract

No new operation. One documented response added to an existing one (section 4):
`DELETE /api/v1/teams/{teamId}` gains `409` (`team_in_use`). The pages use
`GET`/`POST /api/v1/teams`, `GET`/`PATCH`/`DELETE /api/v1/teams/{teamId}`,
`POST /api/v1/teams/{teamId}/members`, `DELETE /api/v1/teams/{teamId}/members/{accountId}`
and `GET /api/v1/people`.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                               | Covers criterion |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| 1   | unit        | contract: `DELETE /api/v1/teams/{teamId}` documents `409`; the generated OpenAPI document lists it                                                                 | contract         |
| 2   | unit        | `AppSidebar`: a Teams link to `/teams` for everyone; People still only with `canManageAccounts`                                                                    | sidebar          |
| 3   | integration | `/teams` and `/teams/{teamId}` render for every role with `canManageTeams` true only for Manager and Admin; a non-UUID team id throws Next's not-found signal      | access           |
| 4   | unit        | `TeamsPage`: loading, rows with link and member count, empty state, error with Retry, "Load more" appends and disappears on the last page                          | list             |
| 5   | unit        | new team: browser validation, `409 team_name_taken` at the field, success navigates to the team page; no button when read-only                                     | create           |
| 6   | unit        | `TeamPage`: members with the Deactivated badge; `404` shows "This team does not exist." with a link back                                                           | team             |
| 7   | unit        | rename: prefilled, validated, `409` at the field, heading updates                                                                                                  | rename           |
| 8   | unit        | add member: search queries `people?q=` after typing stops, hides members and deactivated people, adds the chosen person, `409 account_inactive` message            | add              |
| 9   | unit        | remove member: named button per row, row leaves on `204`, failure announced and row kept                                                                           | remove           |
| 10  | unit        | delete: confirmation text, cancel does nothing, `204` navigates to `/teams`, `409 team_in_use` announced and the team kept                                         | delete           |
| 11  | unit        | read-only: with `canManageTeams` false, none of the controls of tests 5 and 7 to 10 render                                                                         | read-only        |
| 12  | unit        | every control has an accessible name; each outcome is announced in the status region; Escape closes a dialog and returns focus to its button                       | accessibility    |
| 13  | unit        | the People tests pass unchanged after the API client move                                                                                                          | refactor         |
| 14  | e2e         | a Manager creates a team, adds two people, renames it, removes one, deletes it; a team with an assigned task (made through the API) cannot be deleted and says why | end to end       |
| 15  | e2e         | a Viewer sees Teams in the sidebar and both pages without any control                                                                                              | read-only        |
| 16  | e2e         | axe finds no violations on both pages in light and dark mode; at phone width there is no horizontal page scroll                                                    | accessibility    |
| 17  | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; `pnpm openapi:generate` leaves no diff                                                                    | gate             |

## Risks and open questions

For the owner:

1. **Everyone sees the Teams page, read-only for Viewers and Members.** Reading teams is
   already open to every role through the API, and people need to know who is in which team
   to assign work. The alternative is a page for Managers and Admins only, like People is
   for Admins. **Recommend: everyone.**
2. **Two pages, `/teams` and `/teams/{teamId}`**, so a team has a link that can be shared.
   The alternative is one page with a side panel. **Recommend: two pages.**
3. **Removing a member has no confirmation**; deleting a team does. Adding someone back is
   one step; a deleted team is gone. **Recommend: as proposed.**
4. **The People API helpers move to `src/lib/api-client.ts`**, so both pages share one
   error type. A small refactor of finished code, covered by its own tests. **Recommend:
   move them.** The alternative is copying them.
5. **The delete-team contract gains its missing `409 team_in_use`** (section 4), here rather
   than in a separate item, because this page is the first client to rely on it.
   **Recommend: fix it here.**

Technical, settled by the tests:

6. **A large team** shows all its members, as the API returns them whole (WS-026). Fine for
   teams of up to a few hundred people.
7. **Search as you type** sends at most one request per 250 ms pause; an answer that arrives
   after a newer one is ignored, so the list never shows stale results.
