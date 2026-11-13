# WS-020 — Admin "People" page

- Status: Approved (by the owner on 2026-11-13, all open questions accepted as proposed)
- Work-item: [WI-020](../work-items/WI-020-people-page.md)
- Canonical docs: [0003](../canonical/0003-task-management.md) section 3;
  [0004](../canonical/0004-api-conventions.md) sections 5 and 7;
  [WS-017](WS-017-sign-in-page-and-protected-shell.md), [WS-018](WS-018-account-management-api.md);
  `AGENTS.md` hard rules 4 and 6, section 3

## Approach

### 1. Access

- **Sidebar.** `AppShell` gains a prop `canManageAccounts` (a boolean the `(app)` layout
  computes from the actor's permissions, `can(actor, "accounts:manage")`). `AppSidebar` shows a
  "People" link (`/people`, a `UsersIcon`) in its main navigation only when it is true. The
  existing shell test that says the navigation holds no links stays true for everyone else.
- **Page.** `src/app/(app)/people/page.tsx` is a server component. It calls `requireAccount()`
  and, because it is a page of data for Admins, a permission check: an actor without
  `accounts:manage` gets `notFound()`, so the page does not even confirm that it exists
  (question 1). The data itself is read by the browser through `GET /api/v1/accounts`, which
  enforces the same permission, so the page check is a courtesy and the API stays the guard.

### 2. The screen (`src/components/people/`)

All client components; they call the API with `fetch` and parse every response with the shared
Zod schemas of `src/lib/schemas/accounts.ts` and `problem.ts`, so UI and API cannot disagree.

- **`PeoplePage`** holds the list state: loaded items, `nextCursor`, a loading and an error
  state, and one status message region (`role="status"`, visually quiet, announced).
- **`PeopleTable`**: a real `<table>` (semantic header, one row per person). Columns: person
  (name, with the email beneath), role (a select), status (a badge: Invited, Active,
  Deactivated), last seen (a local date and time, "Never" when null) and an actions menu. At
  phone width the table scrolls inside its own container, never the page.
- **Role.** The role select calls `PATCH /api/v1/accounts/{id}` with `{ role }`. The row
  updates from the response. A `409 last_admin` is shown as "This is the only active
  administrator, so they cannot be demoted." Other errors are shown generically. The select is
  disabled for a deactivated account.
- **Actions menu.** Deactivate or Reactivate (`{ active }`), and "Create reset link" or, for an
  invited account, "Create a new invitation link" (`POST .../reset-link`); no link action for a
  deactivated account.
- **Confirmation.** Deactivate, and any change to one's own account, open a confirmation dialog
  that states what happens ("This ends their sessions immediately"). Other role changes happen
  at once, and the status message says that the person was signed out.
- **Self.** After a successful change to the Admin's own role away from Admin, or after
  deactivating themselves, the page `router.replace("/sign-in")` and refreshes: their session
  has ended.
- **Invite dialog.** Name, email and role (default Member), validated in the browser with
  `inviteRequestSchema` and again by the API; the server's field errors are shown next to the
  fields. A line says: "Check the email: it cannot be changed later." On `201` the dialog is
  replaced by the link dialog; the new row is added to the list if the whole list is loaded,
  otherwise the status message says that it appears at the end.
- **Link dialog.** Shows the link in a read-only field, a "Copy link" button
  (`navigator.clipboard.writeText`; if it fails the field is selected and the message says to
  copy it), the expiry, and "This link is shown only now. It works once." The link lives only
  in this component's state and is dropped when the dialog closes.
- **Load more.** A button while `nextCursor` is not null, which requests the next page with the
  cursor and appends it.

### 3. New UI components

`table`, `dialog`, `select` and `badge` are added to `src/components/ui/` in the repository's
shadcn style (`radix-nova`, `lucide`), as `AGENTS.md` section 3 describes ("copied in and owned
by this repo"). They use the `radix-ui` package that is already installed: **no new
dependency**. They are added with the shadcn CLI if it can run in this environment, and
otherwise written by hand to match the existing `button.tsx`, `dropdown-menu.tsx` and
`input.tsx`.

### 4. The mistyped-email gap

`docs/README.md` records that an email can be neither corrected nor freed: no email change and
no deletion, so an invitation sent to a mistyped address keeps it taken, and the follow-up asks
this item to decide where it shows. It shows in the invite dialog (the line above). Fixing it
properly needs an API, for example _revoking an invitation that was never accepted_ (delete
that account, which frees its email), with its own permission check, audit action and tests.
That is a separate work-item (I would call it WI-024), not part of this UI item (question 3).

## Files

| Path                                                                  | Change                                       |
| --------------------------------------------------------------------- | -------------------------------------------- |
| `src/app/(app)/people/page.tsx`, `page.integration.test.ts`           | create (tests first)                         |
| `src/components/people/*.tsx` and `*.test.tsx`                        | create (tests first)                         |
| `src/components/ui/{table,dialog,select,badge}.tsx`                   | create                                       |
| `src/components/app-shell/app-shell.tsx`, `app-sidebar.tsx` (+ tests) | modify: `canManageAccounts`, the People link |
| `src/app/(app)/layout.tsx`, `layout.integration.test.ts`              | modify: pass the permission                  |
| `tests/e2e/people.spec.ts`                                            | create                                       |
| `docs/README.md`, WT-02, WI-020, WS-020                               | statuses; the follow-up is resolved there    |

No new dependency, no migration, no API change.

## Data model changes

None.

## API contract

None. The page uses `GET /api/v1/accounts`, `POST /api/v1/accounts`,
`PATCH /api/v1/accounts/{accountId}` and `POST /api/v1/accounts/{accountId}/reset-link`.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                                             | Criterion     |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| 1   | unit        | `AppSidebar`: shows a People link to `/people` when `canManageAccounts`, none otherwise; `AppShell` passes the flag through                                                                      | access        |
| 2   | integration | `/people` page: renders for an Admin, throws Next's not-found signal for a Manager, Member and Viewer; the `(app)` layout passes `canManageAccounts` correctly                                   | access        |
| 3   | unit        | `PeoplePage` shows a loading placeholder, then the rows with name, email, role, status badge and last seen ("Never" for null); an API failure shows an error and Retry reloads                   | list          |
| 4   | unit        | "Load more" appears while `nextCursor` is set, requests the next page with that cursor, appends, and disappears on the last page                                                                 | pagination    |
| 5   | unit        | invite dialog: validates in the browser, shows the server's field errors, posts `{ name, email, role }`, says the email cannot be changed, then shows the link                                   | invite        |
| 6   | unit        | link dialog: shows the link, expiry and the shown-once notice; "Copy link" writes it to the clipboard; if that fails the message says to copy it by hand; closing removes the link from the page | link          |
| 7   | unit        | role change: PATCHes `{ role }`, updates the row; a `409 last_admin` shows the plain-words message and leaves the row; the select is disabled for a deactivated account                          | role          |
| 8   | unit        | deactivate asks for confirmation that says sessions end; cancel does nothing; confirm PATCHes `{ active: false }`; reactivate PATCHes `{ active: true }`                                         | deactivate    |
| 9   | unit        | reset link: "Create reset link" for active and "Create a new invitation link" for invited post to `.../reset-link` and show the link; no such action for deactivated                             | reset link    |
| 10  | unit        | own account: changing one's own role asks for confirmation; after success the router is sent to `/sign-in`; the same for deactivating oneself                                                    | self          |
| 11  | unit        | the status message region (`role="status"`) announces each outcome; the table has headers and every control has an accessible name                                                               | accessibility |
| 12  | unit        | the invite and role controls are reachable and operable by keyboard (tab order, Enter, Escape closes dialogs and returns focus)                                                                  | accessibility |
| 13  | e2e         | in a browser: Admin opens People, invites a person and reads the link, changes their role, deactivates and reactivates them                                                                      | end to end    |
| 14  | e2e         | a Member does not see People in the sidebar and gets the not-found page at `/people`                                                                                                             | access        |
| 15  | e2e         | at phone width the page has no horizontal scroll and the table scrolls inside its container; dark theme renders the table and dialogs                                                            | responsive    |
| 16  | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`                                                                                                                                          | gate          |

## Risks and open questions

For the owner:

1. **What a non-Admin sees.** The People item is absent from their sidebar and `/people` is a
   plain "not found" page, so it does not confirm that the page exists. The alternative is a
   "you do not have access" page. I recommend not found. Agree?
2. **Confirmations.** Deactivating and any change to your own account ask first, and say what
   will happen. Changing someone else's role happens at once (and ends that person's
   sessions, which the status message says). The alternative is to confirm every role change.
   Agree?
3. **The mistyped email.** WI-020 only warns about it, in the invite dialog. A real way out,
   revoking an invitation that was never accepted so its email is free again, is new API
   surface (and a new audit action), so it would be its own work-item after WI-021. Agree
   to keep WI-020 UI-only?
4. **New UI components.** `table`, `dialog`, `select` and `badge`, in the existing shadcn
   style, copied into the repository, with no new dependency. Agree?

Technical, settled by the tests:

5. **Clipboard.** `navigator.clipboard` needs a secure context (https or localhost). If it is
   unavailable the field is selected and the message says to copy by hand; test 6 covers it.
6. **Timezones.** "Last seen" is formatted in the browser's own timezone after the page has
   loaded in the browser, so the server and the browser cannot disagree during hydration.
7. **Radix `Select` in tests.** jsdom lacks some pointer APIs Radix uses; the unit tests may
   need small, documented polyfills in `vitest.setup.ts`. If that proves fragile, the role
   control becomes a native `<select>` styled like the rest, and I say so in the record.
