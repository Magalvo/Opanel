# WS-092 — The project's "Triage" settings section

- Status: Proposed
- Work-item: [WI-092](../work-items/WI-092-triage-section.md)
- Canonical docs: [0001](../canonical/0001-ai-qa-agents-and-triage.md) section 6 (routing);
  [0003](../canonical/0003-task-management.md) section 3 (Managers edit routing rules);
  [WT-06](../work-tracks/WT-06-bug-reports-and-triage.md) decisions 4 and 15;
  [WS-087](WS-087-triage-settings-api.md) (the API); [WS-036](WS-036-projects-pages.md)
  (the settings page); [WS-049](WS-049-live-detail-epics-settings.md) (its live updates)

## Approach

### 1. Where things stand (checked on 2026-11-20 against `main`, `6b8d764`)

- The settings page (`src/app/(app)/projects/[projectKey]/settings/page.tsx`) is shown to
  holders of `projects:manage` and anyone else gets not-found. It renders
  `ProjectSettings` (`src/components/projects/project-settings.tsx`): one status line, then
  the Details, Columns and Deleted tasks sections. It passes `canRestoreTasks` from
  `can(actor, "tasks:delete_any")`.
- `projects:manage` and `teams:manage` are held by exactly the same human roles, Manager
  and Admin (`src/server/auth/roles.ts`), and by no agent preset that could sign in to the
  web UI. So everyone who reaches the page may change triage today; the check is still
  made separately, since they are different permissions (question 1).
- `GET /api/v1/projects/{projectId}/triage` (`projects:read`) answers
  `TriageSettings { triageTeamId, rules: { frontend, api, backend }, version }`; `PATCH`
  (`teams:manage`) takes `{ triageTeamId?, rules?: {…}?, version }`, answers the new
  settings, `409 version_conflict` with `current` (`TriageSettings`), `409
project_archived`, or `400` with a field error "There is no such team." The settings
  carry the **project's** version, and a change bumps it and publishes `project.changed`
  (WS-087 sections 3 and 4). `projectId` takes the project's key too
  (`projectRefSchema`), as every other call of the settings page does.
- The frame (`ProjectFrame`, WS-049) reads the project again on a newer `project.changed`
  and sets it; `useProject()` gives `{ project, setProject }` to every section.
- The task detail lists teams with `listAllTeams()` (`src/components/task/api.ts`), every
  page of `GET /api/v1/teams`, and picks a team with a native `<select>` whose first
  option is "No team".

### 2. The section (`src/components/projects/triage-section.tsx`, new)

A `<section>` labelled by its heading "Triage", after Columns and before Deleted tasks
(the last section is the only optional one):

- A hint: "Bugs that agents report go to the team of their layer. Bugs of an unknown
  layer, or of a layer with no team, go to the triage team."
- One form with four native `<select>`s, styled like the task detail's, labelled
  "Triage team", "Frontend", "API" and "Backend". Each lists "No team" (value `""`) and
  every team by name, sorted as the API returns them. A value that is not in the list (a
  team created after the list was read) is shown as "Unknown team" rather than silently
  as "No team".
- One "Save" button. It sends every value (`""` → `null`) and the version the section
  holds:
  `PATCH /api/v1/projects/{key}/triage { triageTeamId, rules: { frontend, api, backend },
version }`. Sending the four values rather than only the changed ones keeps the request
  obvious; the server audits only the fields that changed (WS-087 section 4).
- Loading: "Loading triage…" until both the settings and the teams are read; a failure of
  either shows "Could not load the triage settings." with "Retry", like Columns.
- Read-only (every select and Save disabled) when the project is archived, or when the
  viewer lacks `teams:manage` (question 1). The page's existing line "This project is
  archived, so it is read-only." already explains the first.

The fetch helpers go into `src/components/projects/api.ts`: `getTriage(key)` and
`updateTriage(key, body)`, parsed with `triageSettingsSchema`. `listAllTeams` moves from
`src/components/task/api.ts` to `src/components/teams/api.ts`, and the task's `api.ts`
re-exports it, as it already does `searchPeople`, so the projects code does not import
from the task code.

### 3. Saving and its answers

All messages go to the page's status line (`announce`), as the other sections do.

| Answer                                        | The section                                                                                                                                                 |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `200`                                         | shows the answer, takes its version, says "Saved.", then reads the project and sets it in the frame (below)                                                 |
| `409 version_conflict` with a valid `current` | shows `current` and takes its version; says "The project changed since these settings were loaded. The current settings are shown; make your change again." |
| `409 project_archived`                        | says "The project is archived." (the frame learns it from the event)                                                                                        |
| `400` with a field error                      | says "A team you chose no longer exists. The list of teams was refreshed." and reads the teams again; choices are kept                                      |
| anything else                                 | says "Could not save. Try again."; choices are kept                                                                                                         |

**The page's project after a save.** A triage save bumps the project's version. The frame
would learn it from the `project.changed` event, but until then the Details form holds the
old version, and a quick Details save would get a needless conflict. So after a `200` the
section reads the project (`GET /projects/{key}`) and sets it in the frame, where the
Details form takes the new version when it has no unsaved edits (WS-049 section 5). The
event that follows is then not newer and changes nothing. If that read fails, the event
still brings it.

### 4. Live (WS-049)

The section compares the frame's `project.version` with the version it holds:

- **Newer, no unsaved choices** (the draft equals the settings last shown): read the
  settings again and show them, silently. This covers someone else's triage change,
  someone else's change to the project's details or archived state, and one's own Details
  save, which also bumps the version.
- **Newer, with unsaved choices**: keep them and the held version; say "The project
  changed since these settings were loaded. Saving will show the current settings
  first." The next save gets `409 version_conflict` and section 3's conflict row.
- **Reconnect** (`onReconnect`): read the settings and the teams again, by the same rule
  (unsaved choices are kept).
- Teams have no project event; the list is read on load, on reconnect, and after the
  `400` above.

The messages say "the project changed", not "someone else changed", because the version
is shared: one's own save in Details also makes a Triage draft stale (question 2).

### 5. The page

`page.tsx` passes `canManageTriage={can(actor, "teams:manage")}`; `ProjectSettings` passes
it to the section with `readOnly={archived || !canManageTriage}`.

### Considered and not chosen

- **Saving on every select change** (no Save button): each change is a request, an audit
  entry and a version bump; four of them in a row would make the Details form stale four
  times. The other forms of the page save explicitly.
- **shadcn `Select`**: the task detail picks teams with a native `<select>`, which is
  accessible, works with Playwright's `selectOption`, and is already styled; one picker per
  concept across the app.
- **Patching the frame's project locally** (`{ ...project, version }`) after a save:
  `updatedAt` would be wrong, and one `GET` is cheap.

## Files

| Path                                                                         | Change                                    |
| ---------------------------------------------------------------------------- | ----------------------------------------- |
| `src/components/projects/project-settings.test.tsx`                          | modify: the tests below (first)           |
| `src/components/projects/triage-section.tsx`                                 | create: sections 2 to 4                   |
| `src/components/projects/project-settings.tsx`                               | modify: the section and `canManageTriage` |
| `src/components/projects/api.ts`                                             | modify: `getTriage`, `updateTriage`       |
| `src/components/teams/api.ts`, `src/components/task/api.ts`                  | modify: `listAllTeams` moves, re-exported |
| `src/app/(app)/projects/[projectKey]/settings/page.tsx` (+ integration test) | modify: `canManageTriage`                 |
| `tests/e2e/projects.spec.ts`                                                 | modify: the end-to-end test below         |
| `docs/README.md`, WT-06, WI-092, WS-092                                      | modify: statuses                          |

No migration, no API change, no new dependency.

## Data model changes

None.

## API contract

None: the section uses `GET /api/v1/teams` and `GET`/`PATCH
/api/v1/projects/{projectId}/triage` as WS-087 defined them.

## Test plan (written first, in this order)

Unit tests are in `project-settings.test.tsx`, which renders the whole page in the frame
with the fake API and fake event source; its existing tests get default answers for the
triage and teams requests.

| #   | Level       | Test                                                                                                                                                                                        | Covers criterion |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit        | the "Triage" region shows the hint and four selects with "No team" and every team; each is set from `GET …/triage`; an id not among the teams shows "Unknown team"                          | 1                |
| 2   | unit        | Save sends `PATCH …/triage` with the four values (`null` for "No team") and the held version; shows the answer; says "Saved."                                                               | 2                |
| 3   | unit        | after a save the project is read and set: a Details save that follows sends the new version                                                                                                 | 4                |
| 4   | unit        | `409 version_conflict`: `current` shown, its version held, the conflict message                                                                                                             | 3                |
| 5   | unit        | `409 project_archived`, `400` (message, teams read again, choices kept), `500` (message, choices kept)                                                                                      | 3                |
| 6   | unit        | archived project: every select and Save disabled; `canManageTriage` false: the same                                                                                                         | 6                |
| 7   | unit        | settings or teams fail to load: the alert and Retry, which reads them again                                                                                                                 | 1                |
| 8   | unit        | live: a newer project version with nothing unsaved reads the settings again; with unsaved choices keeps them, says so, and saves with the old version; a reconnect reads settings and teams | 5                |
| 9   | integration | the settings page passes `canManageTriage` from `teams:manage`                                                                                                                              | 6                |
| 10  | e2e         | a Manager sets the triage team and the Frontend team of a new project, sees "Saved.", reloads, and finds both; the API's `GET …/triage` agrees                                              | 1, 2, 8          |
| 11  | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`                                                                                                                                     | 8                |

Criterion 7 (only `/api/v1`) holds by construction: the fake API in tests 1 to 8 answers
only those paths and fails any other request.

## Risks and open questions

For the owner:

1. **Who sees the section, and how.** Only Managers and Admins reach the settings page
   (`projects:manage`), and they all hold `teams:manage`, so today the question only
   matters if roles change. Options: (a) shown to everyone on the page, editable with
   `teams:manage`, read-only without; (b) hidden without `teams:manage`, like Deleted
   tasks without `tasks:delete_any`. **Recommend (a)**: the settings are readable by
   anyone with `projects:read` through the API, so showing them hides nothing, and a
   read-only view tells a project manager who to ask.
2. **The shared version makes Details and Triage drafts stale for each other** (WS-087
   question 2, decided). With unsaved edits in both, saving one makes the other's save a
   conflict that shows the current values. Section 3 removes the case without unsaved
   edits by refreshing the frame's project after a save. **Recommend: accept it**; the
   messages say "the project changed" rather than "someone else changed".
3. **One Save for the section**, sending all four values, rather than saving on each
   select change. **Recommend: one Save.**
4. **Native `<select>`, as in the task detail**, rather than shadcn's `Select`.
   **Recommend: native.**
5. **Placement: after Columns, before Deleted tasks.** **Recommend: as proposed.**

Risks:

- **Item F (WI-091) runs at the same time** and edits the task detail, including possibly
  `src/components/task/api.ts`. Moving `listAllTeams` touches one export there; the
  re-export keeps every import working, and the merge is a few lines.
- **E2E port 3100 is shared** with the item F session on this machine; the gate is run
  when it is free.
