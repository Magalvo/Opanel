# WS-077 — The Agents page

- Status: Done (approved by the owner on 2026-11-19, questions 1 to 5 as proposed)
- Work-item: [WI-077](../work-items/WI-077-agents-page.md)
- Canonical docs: [WT-05](../work-tracks/WT-05-agent-accounts-and-tokens.md) (decision 13,
  the page; decisions 1, 4, 7, 11); [WS-075](WS-075-agents-admin-api.md) (the API);
  [WS-020](WS-020-people-page.md) (the People page, the model for this one);
  [0004](../canonical/0004-api-conventions.md) (errors); AGENTS.md section 3 (the UI uses
  `/api/v1` only)

## Approach

### 1. Where things stand (checked on 2026-11-19, `main` at `850a9ae`)

- The API exists: seven operations under `/api/v1/agents` (WS-075), with Zod schemas in
  `src/lib/schemas/agents.ts` that the browser can import.
- The People page is the model. It has:
  - a server page that returns `notFound()` without the permission
    (`src/app/(app)/people/page.tsx`);
  - a client component that reads the API through `src/lib/api-client.ts`
    (`src/components/people/`);
  - a table, an invite dialog, and a one-time link dialog with a copy button
    (`link-dialog.tsx`, WS-020);
  - the sidebar link, shown when `canManageAccounts` is true (`app-sidebar.tsx`).
- The UI components available are `alert-dialog`, `badge`, `button`, `dialog`,
  `dropdown-menu`, `input`, `select`, `table` and `textarea`. There is no checkbox.
  `radix-ui` 1.8.1 contains one, so the shadcn/ui `checkbox` component can be copied in
  with no new dependency.
- The Agent badge exists (WS-074).
- `GET /api/v1/projects` lists projects for the project picker. An Admin holds
  `projects:read`.

### 2. Routes and navigation

- `src/app/(app)/agents/page.tsx` and `src/app/(app)/agents/[agentId]/page.tsx` are
  server pages. Each calls `requireAccount()` and returns `notFound()` without
  `agents:manage`, as People does. The data is read by the browser through the API.
- The sidebar gains "Agents" (icon `BotIcon`) after People, shown with a new
  `canManageAgents` prop that the `(app)` layout computes like `canManageAccounts`.
  Today both permissions belong to Admins only, but each link follows its own
  permission.

### 3. The list (`src/components/agents/agents-page.tsx`)

- **Table columns:** Name (a link to the agent's page), Role ("QA agent", "Worker
  agent"), Status ("Active" or "Disabled", the latter as a muted badge), Last seen
  (relative, as People shows it).
- "Load more" while there is a `nextCursor`, as People does.
- **Empty state:** "No agents yet. Agents are programs that use Opanel's API with a
  token." and a "New agent" button.
- "New agent" opens `AgentFormDialog` in create mode. On success the dialog closes and
  the browser goes to the new agent's page, where the next step, creating a token, is.

### 4. The form (`agent-form.tsx`), shared by create and edit

- **Name** (input, 1 to 80) and **Description** (textarea, optional, up to 500).
- **Role** (select): "QA agent" or "Worker agent", each with one line saying what it
  allows.
- **Scopes**: one checkbox per scope of the chosen role, each with a plain label (for
  example "Read tasks, epics and comments" for `tasks:read`).
  - When creating, all of them start checked.
  - Changing the role unchecks and hides the scopes the new role lacks. Scopes the new
    role adds are not checked automatically, which matches WS-075 question 3.
- **Projects**: a radio group, "All projects" or "Only these projects". The second
  shows the projects as checkboxes, archived ones included and marked "(archived)".
  They are loaded with every page of `GET /api/v1/projects`, then of
  `GET /api/v1/projects?archived=true`, which lists only the archived ones (open
  question 2).
- **Submit** sends only the fields that changed (edit) or all of them (create).
- **Errors:** field errors from a `400` go next to their field, `agent_name_taken`
  next to Name, and anything else in a form-level alert.

### 5. The agent's page (`agent-detail.tsx`)

- **Header:** the name with the Agent badge, the role, the status, "Created" and "Last
  seen".
- **Details**, read-only, with an "Edit" button that opens the form in edit mode.
- **"Disable agent" or "Re-enable agent"**, behind an alert dialog. Disabling says: "Its
  tokens stop working at once. Nothing is deleted."
- **Tokens:** a table with Name, Created, Expires ("Never" when null), Last used and
  Status, and a "Revoke" action on active tokens, behind an alert dialog.
  - "Create token" is disabled, with an explanation, when the agent is disabled. The
    server's `409 agent_disabled` is still handled.

### 6. Creating a token (`token-dialog.tsx`)

- **Step 1:** Name, and an Expiry select with "30 days", "90 days" (preselected),
  "1 year" and "No expiry". The last option comes with a warning line: "A token that
  never expires is valid until it is revoked."
- **Step 2,** after `201`, in the same dialog:
  - the token in a read-only input, with "Copy" (the same fallback as `link-dialog.tsx`);
  - "This token will not be shown again. Store it where the agent reads its
    configuration.";
  - one "Done" button.
- The token lives only in the dialog's state. It is cleared when the dialog closes, and
  it is never put in the URL, in storage or in a log (hard rule 7).
- `too_many_tokens` reads: "This agent already has 10 usable tokens. Revoke one first."

### 7. API client (`src/components/agents/api.ts`)

`listAgents`, `getAgent`, `createAgent`, `updateAgent`, `listTokens`, `createToken` and
`revokeToken` follow `components/people/api.ts`, and parse each response with its Zod
schema.

### Considered and not chosen

- **Editing the agent in place on the list**, as People changes roles in a menu: an agent
  has too many fields, and tokens need their own space.
- **Showing the token again or later**: impossible by design. Only its hash is stored.
- **A project multi-select combobox**: there is no such component in `components/ui`,
  and a checkbox list is accessible as it is. Open question 2 covers the scale.

## Files

| Path                                                                                                                                         | Change                             |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `src/app/(app)/agents/page.tsx`, `src/app/(app)/agents/[agentId]/page.tsx` (+ integration tests)                                             | create: section 2                  |
| `src/app/(app)/layout.tsx`, `src/components/app-shell/app-shell.tsx`, `app-sidebar.tsx` (+ tests)                                            | modify: the Agents link            |
| `src/components/ui/checkbox.tsx`                                                                                                             | create: shadcn/ui, from `radix-ui` |
| `src/components/agents/agents-page.tsx`, `agent-form.tsx`, `agent-detail.tsx`, `token-dialog.tsx`, `api.ts`, `labels.ts` (+ component tests) | create: sections 3 to 7            |
| `tests/e2e/agents.spec.ts`, `tests/e2e/accessibility.spec.ts`                                                                                | create, modify                     |
| `docs/README.md`, WT-05, WI-077, WS-077                                                                                                      | modify: statuses                   |

## Data model changes

None.

## API contract

None. The page uses the endpoints of WS-075 and `GET /api/v1/projects`.

## Test plan (written first, in this order)

| #   | Level            | Test                                                                                                                                                                                                                                                                                                                   | Covers criterion |
| --- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | integration      | `/agents` and `/agents/{id}` render for an Admin and are not-found for a Manager, a Member and a Viewer                                                                                                                                                                                                                | 1                |
| 2   | unit             | the sidebar shows "Agents" only with `canManageAgents`                                                                                                                                                                                                                                                                 | 1                |
| 3   | unit (component) | the list: rows with role and status labels, "Load more", the empty state                                                                                                                                                                                                                                               | 2                |
| 4   | unit (component) | the form: the scopes of the chosen role all checked when creating; a role change hides the scopes the new role lacks and checks nothing new; "Only these projects" sends the chosen ids and "All projects" sends `null`; field errors and `agent_name_taken` shown by their fields; edit sends only the changed fields | 3, 4             |
| 5   | unit (component) | the agent's page: details, the disable and re-enable confirmations, token rows with each status, "Revoke" only on active ones, "Create token" disabled for a disabled agent                                                                                                                                            | 4, 6             |
| 6   | unit (component) | the token dialog: 90 days preselected; the "No expiry" warning; after creation the token is shown with "Copy" and the sentence; after closing and reopening, it is gone; `too_many_tokens` explained                                                                                                                   | 5                |
| 7   | e2e              | an Admin creates an agent restricted to one project, creates a token, and the token works on the API (`GET /api/v1/projects` lists only that project); the Admin revokes it, and the same request is `401`                                                                                                             | 3, 5, 6          |
| 8   | e2e              | the Admin disables the agent (its token gets `401`), re-enables it (`200` again), and edits its scopes                                                                                                                                                                                                                 | 4                |
| 9   | e2e              | axe on the list, the agent's page and the token dialog (showing a token), in light and dark mode                                                                                                                                                                                                                       | 7                |
| 10  | e2e              | a Manager gets the not-found page at `/agents`, and has no Agents link                                                                                                                                                                                                                                                 | 1                |
| 11  | gate             | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`                                                                                                                                                                                                                                                                | 8                |

## Risks and open questions

For the owner:

1. **After "New agent", go to the agent's page** rather than staying on the list. The
   next step is always a token, and it lives there. **Recommend: go to the agent's
   page.**
2. **Projects as a checkbox list, loaded whole**, archived ones included and marked. One
   organization's projects number in the tens. If an install ever has hundreds, a
   searchable picker can replace it without an API change. **Recommend: as proposed.**
3. **Scope labels in plain language**, with the scope name as a hint (`tasks:read`),
   rather than only the scope names. Agent authors see the names in the OpenAPI
   document; Admins read the sentence. **Recommend: both, as proposed.**
4. **"No expiry" offered with a warning**, as WT-05 question 3 allows, rather than
   hidden behind an "advanced" toggle. **Recommend: as proposed.**
5. **Its own `canManageAgents` prop**, rather than reusing `canManageAccounts`. Both
   are Admin-only today, but they are different permissions. **Recommend: its own.**

Risks:

- The end-to-end tests change the database through the UI, with their own Admin
  (WS-052's isolation). Port 3100 is still shared, so E2E runs take turns (the Follow-up
  about `E2E_PORT`).

## Deviations from the approved spec

1. **The role and the expiry are radio groups, not selects.** With two roles, each with a
   line of explanation, and four expiries, one of them with a warning, the options read
   better side by side. Native radios are also simpler to use from the keyboard and with
   a screen reader than a popup list.
2. **"Disable agent" uses the `outline` button, not `destructive`.** axe found the shared
   `destructive` style below WCAG AA contrast in light mode, which is the open Follow-up
   in `docs/README.md` about that style. The confirmation dialog still says what
   disabling does. The Follow-up stays open for the style itself.
3. **The component tests are one file**, `src/components/agents/agents.test.tsx`, with one
   `describe` per component and a shared fake API.
4. **Typed routes:** `pnpm typecheck` needs the route types to know `/agents`. Locally,
   `next typegen` regenerates them (the note in `CONTRIBUTING.md` about stale `.next`
   applies). A fresh clone and CI generate them as before.

## Implementation record

- Red:
  - the sidebar test failed on the missing "Agents" link;
  - the two page tests could not import their components;
  - the component tests could not import the components.
- Green:
  - the two server pages and the `canManageAgents` prop;
  - `components/ui/checkbox.tsx` (shadcn/ui, from `radix-ui` 1.8.1, no new dependency);
  - the list, the form, the agent's page and the token dialog, with their API client and
    labels.
  - Component tests 12 of 12, sidebar tests 16 of 16, page tests 10 of 10.
- E2E: `agents.spec.ts` (3 tests) and the accessibility test (light and dark). The first
  run found the contrast problem of deviation 2; after the fix, every test passes.
- Gate on 2026-11-19:
  - typecheck, lint and Prettier pass;
  - Vitest 1534 of 1534;
  - `pnpm test:e2e` 85 of 86 with `--retries=0`: `live-board.spec.ts` "a deleted task
    disappears from the other board, and comes back when restored" failed once, in a
    file this item does not touch, and `live-board.spec.ts` alone then passed 8 of 8.
  - Windows, Node 24, pnpm 10.28.0, Compose PostgreSQL on port 5433.
