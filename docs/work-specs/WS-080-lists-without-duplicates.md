# WS-080 — Paged lists never show a row twice

- Status: Approved (by the owner on 2026-11-19, every question as proposed)
- Work-item: [WI-080](../work-items/WI-080-lists-without-duplicates.md)
- Canonical docs: [0004](../canonical/0004-api-conventions.md) section 5 (pagination);
  audit of 2026-11-19, finding B02

## Approach

### 1. What goes wrong today (read on 2026-11-19)

Six components each keep `items`, `nextCursor` and a `loadMore` that appends
`[...current, ...page.items]`. None checks ids. The gaps:

- **People** (`src/components/people/people-page.tsx`). `invited()` (194-202) tests
  `nextCursor === null` from its render closure. `InviteDialog` is rendered in every phase
  (220), and its `submit` (`invite-dialog.tsx:49-70`) awaits `inviteAccount` and then calls
  the `onInvited` it captured at submit time. Invite while the first page loads: the
  closure still holds the initial `null` (75), so the account is appended (196); the first
  page then arrives with a cursor, and "Load more" (110-122) returns the same account again.
  The same happens without a race whenever the closure is one render old. The two E2E
  failures in `tests/e2e/people.spec.ts:84-98` are this: the run's database holds more than
  50 accounts, so the newest sit on page two.
- **Epics** (`src/components/epics/epics-page.tsx`). `loadMore` (94-103) has no
  `loadingMore` guard and the button (295) is never disabled, so a double click appends the
  same page twice. `onCreated` (212-214) appends the new epic even when `nextCursor !== null`
  and the list is ordered by title (`src/server/services/epics.ts:103`), so a later "Load
  more" can return it again. A `loadMore` can land after `reloadShown` (114-149) replaced
  the list, or after the "Show" choice changed (effect 72-85), and append a stale page.
- **Comments** (`src/components/task/comments-section.tsx`). `loadMore` (79-89) has no
  guard, and the button (142-148) is never disabled. One's own comment is appended at once
  (103-105) even while `cursor !== null`; "Load more" later returns it again. A `loadMore`
  can also land after `reloadShown` (51-66).
- **Agents, teams, projects** (`agents-page.tsx:63-74`, `teams-page.tsx:61-73`,
  `projects-page.tsx:71-83`) are guarded by `loadingMore` but do not dedupe. Projects can
  append the old view's page if "Active/Archived" switches while "Load more" runs (the
  effect's `cancelled` flag, 50-62, covers only the first page).

### 2. The fix: one pure helper and one small hook

**`mergePage(current, incoming)`** in `src/lib/paged-list.ts`: returns `current` without
any item whose id is in `incoming`, followed by `incoming`. The server's order wins: an item
added locally and returned later moves to the position the server gives it, once. Pure,
generic over `{ id: string }`, readonly in and out.

**`usePagedList<T extends { id: string }>(initial?)`** in `src/hooks/use-paged-list.ts`,
owning only the paging state (phase, messages and rendering stay in each page):

```ts
interface Page<T> {
  items: readonly T[];
  nextCursor: string | null;
}
function usePagedList<T extends { id: string }>(
  initial?: Page<T>,
): {
  items: readonly T[];
  nextCursor: string | null;
  loadingMore: boolean;
  show(page: Page<T>): void; // replace the list; starts a new generation
  invalidate(): void; // a filter or view changed; starts a new generation
  loadMore(read: (cursor: string) => Promise<Page<T>>): Promise<void>;
  isFullyLoaded(): boolean; // false until a first page is shown
  add(item: T): void; // append unless the id is shown
  update(change: (items: readonly T[]) => readonly T[]): void; // map, filter
};
```

- A **generation** counter in a ref. `show` and `invalidate` bump it. `loadMore` records
  the generation when it starts and drops its page (and swallows its failure) if the
  generation changed meanwhile; otherwise it merges with `mergePage` and sets the cursor. A
  failure in the current generation is rethrown so each page keeps its own message.
- **Guard**: `loadMore` returns at once if the cursor is `null` or a load is running,
  checked against a ref (two clicks in one frame both see `loadingMore === false` in
  state). `loadingMore` state drives the button's `disabled`.
- **Current state, not a closure**: the cursor and "a first page was shown" are mirrored
  in refs, written in the same handlers that set state (never during render, so the React
  Compiler's ref rules hold). `isFullyLoaded()` reads them. Before the first page it answers
  `false`: an invitation finished during the first load is announced as coming "at the end
  of the list", and `show` would discard a local append anyway.
- Only `useState`, `useRef` and `useCallback` are used; no new React API. The implementer
  reads the installed React 19.3.1 and Next 16.4.6 docs before coding (hard rule 13).

### 3. Each page

| Page     | Change                                                                                                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| People   | list from the hook; `invited()` uses `isFullyLoaded()` then `add`; retry and the revoke-409 reload use `show`; `replace` and `revoke` use `update`.                                                           |
| Epics    | effect calls `invalidate()` before reading (`projectKey`, `show` change); `reloadShown` ends with `show`; Load more disabled while loading; `onCreated` keeps adding at once (title order) but through `add`. |
| Comments | hook with `initial`; `reloadShown` ends with `show`; Load more disabled while loading; own comment still shown at once through `add`, and `mergePage` moves it to its place if "Load more" returns it.        |
| Projects | effect calls `invalidate()` when `archived` changes.                                                                                                                                                          |
| Agents   | list from the hook; no behaviour change beyond dedupe and generations.                                                                                                                                        |
| Teams    | list from the hook; no behaviour change beyond dedupe and generations.                                                                                                                                        |

Epics keep their local filter of `shown` (177-179) and the open-epic rule of `reloadShown`.

### Why a hook and not the helper alone

The helper fixes duplicates but not stale pages, double clicks or closure reads; each of
those would need the same refs written correctly six times, which is how the gaps arose. The
hook is ~60 lines, has no rendering, and replaces ~15 lines in each page. A larger hook that
also owns phase, retry and messages would be overkill: the pages differ there (comments
start from server props, epics reload live, people reload on a 409). See question 1.

## Files

| Path                                                                | Change                                                            |
| ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `src/lib/paged-list.ts`, `src/lib/paged-list.test.ts`               | create: `mergePage`, `Page<T>` (tests first)                      |
| `src/hooks/use-paged-list.ts`, `src/hooks/use-paged-list.test.tsx`  | create: the hook (tests first)                                    |
| `src/components/people/people-page.tsx`, `people-page.test.tsx`     | modify                                                            |
| `src/components/epics/epics-page.tsx`, `epics-page.test.tsx`        | modify                                                            |
| `src/components/task/comments-section.tsx` and its test             | modify                                                            |
| `src/components/{agents,teams,projects}/*-page.tsx` and their tests | modify                                                            |
| `tests/e2e/people.spec.ts`                                          | modify: the race, deterministic                                   |
| `docs/README.md`, WI-080, WS-080                                    | modify: statuses; close the follow-up "can show an account twice" |

No dependency, no migration, no server code.

## Data model changes

None.

## API contract

None. The OpenAPI document does not change.

## Test plan (written first, in this order)

Component tests follow `people-page.test.tsx` (jsdom, Testing Library, `fetch` stubbed per
call); hook tests follow `src/hooks/use-project-events.test.tsx` (`renderHook`, `act`).

| #   | Level | Test                                                                                                                                                                                                                                                                               | Covers criterion    |
| --- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| 1   | unit  | `mergePage`: disjoint pages append in order; an id in both is kept once at the incoming position; an empty page returns the same items; inputs are not mutated                                                                                                                     | once, server order  |
| 2   | unit  | hook: two `loadMore` calls in the same tick call `read` once; `loadingMore` is true while it runs; a `null` cursor calls nothing                                                                                                                                                   | guard               |
| 3   | unit  | hook: a `loadMore` resolved after `show` or `invalidate` changes nothing; one rejected after them does not throw; one rejected in the current generation throws                                                                                                                    | stale pages dropped |
| 4   | unit  | hook: `isFullyLoaded()` is false before the first `show`, and reads a `show` made in the same handler before any re-render; `add` skips a shown id                                                                                                                                 | current state       |
| 5   | unit  | People: the first list request is held; invite; release it with a cursor; the status says "They appear at the end of the list"; Load more returns the account; exactly one row (fails before: two)                                                                                 | People race         |
| 6   | unit  | Epics: double click on Load more sends one request and the button is disabled meanwhile; a created epic returned by Load more is one row; a Load more answered after "Show" changed is not shown                                                                                   | guard, once, stale  |
| 7   | unit  | Comments: own comment added while a cursor exists, then Load more returns it: one article, at the end; Load more disabled while loading                                                                                                                                            | once, guard         |
| 8   | unit  | Projects: Load more answered after the view switched is not shown. Agents, teams: a repeated id in a later page is one row                                                                                                                                                         | stale, once         |
| 9   | unit  | existing tests of all six components kept, unchanged                                                                                                                                                                                                                               | behaviour kept      |
| 10  | e2e   | `people.spec.ts`: `page.route` holds the first `GET /api/v1/accounts?limit=50` (no cursor) until the invitation is done, then continues it as `limit=1` so a cursor exists; click Load more until gone; the invited email's row has count 1 (fails before: 2). Unroute at the end. | People race (e2e)   |
| 11  | gate  | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; `pnpm openapi:generate` leaves no diff                                                                                                                                                                                    | gate, no contract   |

Test 10 rewrites only the first request's `limit`, so it does not depend on how many
accounts the run's database holds.

## Risks and open questions

For the owner:

1. **A shared hook, or only the helper?** The helper alone leaves the guard, generations and
   closure reads to six hand-written copies. **Recommend: the hook of section 2, limited to
   paging state.**
2. **Migrate agents, teams and projects too?** They show no duplicate today except through
   repeated ids or (projects) a view switch. Migrating them keeps one pattern; leaving them
   out shrinks the diff. **Recommend: all six in this item.**
3. **Where a locally added item sits.** Server order wins: a local append moves when a later
   page returns it. The alternative (first occurrence wins) leaves own comments and new epics
   out of order. **Recommend: server order wins.**
4. **People: invitation during the first load** is announced as "They appear at the end of
   the list" rather than added, since the first page would replace it. **Recommend: as
   proposed.**

## Deviations from the approved spec

None yet.
