# WS-035 — Teams page

- Status: Proposed (must be `Approved` by the owner before any code is written)
- Work-item: [WI-035](../work-items/WI-035-teams-page.md)
- Canonical docs: [0003](../canonical/0003-task-management.md) section 3;
  [0004](../canonical/0004-api-conventions.md) sections 4, 5 and 7;
  [WS-026](WS-026-teams-and-people.md), [WS-020](WS-020-people-page.md);
  [WT-03](../work-tracks/WT-03-board-core.md) decisions 8, 9, 17; `AGENTS.md` hard rules 4
  and 6, section 3

## Approach

### 1. Access

- **Sidebar.** `AppSidebar` shows a "Teams" link (`/teams`, a `UsersRoundIcon`) to every
  signed-in person, above People, which stays Admin-only. Reading teams needs `projects:read`
  and every human role has it.
- **Page.** `src/app/(app)/teams/page.tsx` is a server component. It calls `requireAccount()`
  and computes `canManage = can(actor, "teams:manage")` (Manager and Admin), which it passes
  to the client screen. The page is only a courtesy: the data is read through the API, and
  every write endpoint enforces `teams:manage` itself.

### 2. The screen (`src/components/teams/`)

Client components, in the style of the People page: they call the API with `fetch` and parse
each response with the shared schemas of `src/lib/schemas/teams.ts`, `people.ts` and
`problem.ts`.

- **`TeamsPage`** holds the list, `nextCursor`, loading and error state, and one
  `role="status"` region that announces each outcome. A "New team" button, only if
  `canManage`.
- **`TeamsTable`**: a real `<table>`: team name, member count and a button that opens the
  team ("Members" for a reader, "Manage" for a Manager). At phone width the table scrolls
  inside its container, never the page.
- **`TeamDialog`**: opened on a team. It loads `GET /api/v1/teams/{id}` and lists the members
  by name, with a "Deactivated" badge when `active` is false. For a Manager it adds:
  - a name field with a Rename button (`PATCH /api/v1/teams/{id}`);
  - a "Remove" button per member (`DELETE .../members/{accountId}`);
  - **Add a person**: a search field that calls `GET /api/v1/people?q=` as the person types
    (after a short pause) and lists the matching active people who are not yet members, each
    with an "Add" button (`POST .../members` with `{ accountId }`); the dialog is updated
    from the response, which is the whole team;
  - a "Delete team" button, which opens a confirmation (below).
- **`CreateTeamDialog`**: one name field, validated in the browser with the schema of the
  API; the server's `400` field errors and `team_name_taken` are shown next to the field.
- **Delete.** An alert dialog says "This deletes the team and its memberships. The people
  stay." On `409 team_in_use` it closes with "Tasks are assigned to this team. Reassign them
  first." and the team stays.
- **Errors.** `404` on a team another Manager just deleted: the dialog closes, the row is
  removed and the message says the team no longer exists. Other failures show a generic
  message and leave the state as it was.
- **Load more.** A button while `nextCursor` is not null.

No new UI component: the page uses `table`, `dialog`, `alert-dialog`, `badge`, `button` and
`input`, all in the repository already.

### 3. API contract

`deleteTeamContract` gets the response `409 team_in_use` (the service already answers it,
WS-030). It is a documentation change of the generated OpenAPI document, with no behaviour
change; a test asserts it. No new endpoint, no new problem code.

### 4. Out of scope

Assigning a task to a team (WI-037, WI-038); showing a team's tasks; an agent in a team
(WT-05); team permissions; reordering or archiving teams.

## Files

| Path                                                       | Change                                |
| ---------------------------------------------------------- | ------------------------------------- |
| `src/app/(app)/teams/page.tsx`, `page.integration.test.ts` | create (tests first)                  |
| `src/components/teams/*.tsx`, `api.ts` and `*.test.tsx`    | create (tests first)                  |
| `src/components/app-shell/app-sidebar.tsx` (+ test)        | modify: the Teams link                |
| `src/lib/schemas/teams.ts` (+ test)                        | modify: `409` on `deleteTeamContract` |
| `docs/api/openapi.json`                                    | regenerate                            |
| `tests/e2e/teams.spec.ts`                                  | create                                |
| `docs/README.md`, WT-03, WI-035, WS-035                    | modify: statuses                      |

No new dependency, no migration.

## Data model changes

None.

## API contract

Section 3. The page uses `GET /api/v1/teams`, `POST /api/v1/teams`,
`GET` and `PATCH` and `DELETE /api/v1/teams/{teamId}`, `POST /api/v1/teams/{teamId}/members`,
`DELETE /api/v1/teams/{teamId}/members/{accountId}` and `GET /api/v1/people`.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                    | Criterion     |
| --- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| 1   | unit        | `AppSidebar`: a Teams link to `/teams` for every role, People still only with `canManageAccounts`; the existing navigation tests are updated, not weakened              | access        |
| 2   | unit        | contracts: `deleteTeamContract` documents `409`; the OpenAPI document lists it                                                                                          | contract      |
| 3   | integration | `/teams` page renders for Viewer, Member, Manager and Admin and passes `canManage` true only for the last two; `401`-equivalent redirect without a session              | access        |
| 4   | unit        | `TeamsPage`: loading placeholder, then rows with name and member count; an API failure shows an error and Retry reloads; "Load more" appends and disappears at the end  | list          |
| 5   | unit        | `TeamDialog` for a reader: lists members by name, a Deactivated badge for an inactive one, and no create, rename, delete, add or remove control                         | read only     |
| 6   | unit        | create: validates in the browser, posts `{ name }`, adds the row; `team_name_taken` shown next to the field and nothing added                                           | create        |
| 7   | unit        | rename: PATCHes `{ name }` and updates the row and title; a taken name is shown next to the field                                                                       | rename        |
| 8   | unit        | add a person: typing searches `GET /api/v1/people?q=`, hides current members and inactive people, "Add" posts `{ accountId }` and the list updates from the response    | add member    |
| 9   | unit        | remove a member: DELETE, the member disappears and the count in the list drops                                                                                          | remove member |
| 10  | unit        | delete: asks first, cancel does nothing, confirm deletes and removes the row; `409 team_in_use` shows the plain-words message and keeps the team; `404` removes the row | delete        |
| 11  | unit        | the `role="status"` region announces each outcome; the table has headers; every control has an accessible name; Escape closes dialogs and returns focus                 | accessibility |
| 12  | e2e         | a Manager opens Teams, creates a team, adds and removes a person, renames it and deletes it                                                                             | end to end    |
| 13  | e2e         | a Member sees the teams and their members and none of the management controls; a team with an assigned task cannot be deleted and the page says why                     | access, rule  |
| 14  | e2e         | at phone width the page has no horizontal scroll and the table scrolls inside its container; the dark theme renders the table and dialogs; no axe violations            | responsive    |
| 15  | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; `pnpm openapi:generate` leaves no diff                                                                         | gate          |

Test 13 needs a task assigned to a team, which the e2e seed creates through the API.

## Risks and open questions

For the owner:

1. **Everyone sees Teams.** Viewers and Members get a read-only page, because the people
   directory already shows every name to every signed-in person and teams are needed to
   understand assignments. The alternative is to show the link to Managers only. Agree?
2. **Team detail in a dialog, not its own URL.** Unlike the task detail (WT-03 question 3),
   a team has nothing to share or bookmark. Alternative: `/teams/{id}`. Agree with a dialog?
3. **Adding a person by searching their name**, with no new component and no new dependency
   (a text field and a list of buttons), instead of a combobox library. Agree?
4. **Deleting a team in use is refused by the API**; the page explains it rather than
   offering to reassign tasks, which needs the board (WI-037). Agree?
5. **The contract fix** (`409 team_in_use` listed on delete) is a small change to WI-026's
   contract that WT-03 decision 9 already promised. Included here rather than as its own
   work-item because it is one line and the page depends on it. Agree?
