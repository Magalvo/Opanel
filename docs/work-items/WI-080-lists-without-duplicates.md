# WI-080 — Paged lists never show a row twice

- Status: Done (2026-11-19)
- Work-track: none: a fix from the audit of 2026-11-19 (finding B02)
- Depends on: none
- Work-spec: [WS-080](../work-specs/WS-080-lists-without-duplicates.md)

## Outcome

The People page can show an account twice (open follow-up in `docs/README.md`, seen in two
E2E runs of `people.spec.ts`). The server is not at fault: `listAccounts`
(`src/server/services/account-management.ts:84-113`) pages on `(created_at, id)` with no
repeat and no gap. The cause is in the browser: an invitation finished while the first page
is still loading reads a stale "no more pages" from the render closure, appends the new
account locally, and "Load more" then returns it again. The other paged lists (epics,
comments, agents, teams, projects) copy the same paging code and share some of its gaps: a
"Load more" that can run twice at once, pages that land after the list was replaced or its
filter changed, and no check for an id already shown.

After this item every paged list in the web UI shows each item at most once, whatever the
order of clicks, invitations, creations, live reloads and filter changes.

## Acceptance criteria

- [x] People: inviting someone while the first page loads, then "Load more", shows the
      invited account exactly once (reproduced deterministically end to end).
- [x] People: whether the invited account is added at once is decided from the list's
      current state, not from the state when the dialog was submitted.
- [x] Every "Load more" (people, epics, comments, agents, teams, projects) is disabled while
      it runs, and a second call while one runs asks for nothing.
- [x] A page that arrives after the list was replaced (first load, retry, live reload) or
      after its filter or view changed (epics "Show", projects "Active/Archived") is
      dropped, not appended.
- [x] An item that is already shown and comes back with a later page appears once, at the
      position the server gives it.
- [x] Existing behaviour is kept: one's own new comment and a new epic still appear at once;
      people, agents, teams and projects keep their messages.
- [x] No contract changes; no server code changes.
- [x] The README follow-up "The People page can show an account twice" is closed.
- [x] The full quality gate passes.

## Notes

The board (`use-board.ts`) is not a cursor list and is out of scope. Ordering on the server
(created time for accounts and comments, title for epics) is unchanged.
