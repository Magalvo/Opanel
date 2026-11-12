# WS-017 — Sign-in page, protected app shell, account menu with sign-out

- Status: Proposed (must be `Approved` by the owner before any code is written)
- Work-item: [WI-017](../work-items/WI-017-sign-in-page-and-protected-shell.md)
- Canonical docs: [0004](../canonical/0004-api-conventions.md) section 7;
  [WT-02](../work-tracks/WT-02-accounts-and-permissions.md) decisions 4, 8;
  [WS-015](WS-015-sign-in-and-authentication.md), [WS-016](WS-016-first-run-setup.md);
  `AGENTS.md` hard rules 4, 6, 13

## Approach

Based on the Next.js 16 documentation of the installed version (`authentication.md`,
`proxy.md`, hard rule 13): the former `middleware` is now `proxy`; it should do only
**optimistic** checks, reading the cookie and never the database; and a layout is not a safe
place for the only check, because it is not re-rendered on every navigation. So protection
has three layers, each doing what it is good at.

### 1. Proxy: the optimistic check (`src/proxy.ts`)

For every page request (the matcher excludes `/api`, `/_next/static`, `/_next/image`, the
favicon, `/sign-in` and `/setup`), if neither `opanel.session_token` nor
`__Secure-opanel.session_token` is present, redirect to
`/sign-in?next=<the requested path and query>`. It checks presence only. It is a
convenience that avoids rendering a page for nobody, not a security boundary.

### 2. Verification near the data (`src/server/auth/session.ts`)

`getSession()`, wrapped in React's `cache`, builds a request from the incoming headers
(`headers()` from `next/headers`) and calls `authenticate` (WS-015), returning the
authenticated account or `null`. `requireAccount()` calls it and `redirect("/sign-in")`s on
`null`. The `(app)` layout calls `requireAccount()`, both to refuse an expired, deleted or
deactivated session (the real database check) and to show the account menu. It is the same
`authenticate` that the API uses, so pages and API cannot disagree.

Because a layout is not re-rendered on every navigation, **data is protected where it is
read**: every piece of data reaches the browser through `/api/v1`, which authenticates each
request (rule 6). A server component that ever reads data itself must call
`requireAccount()` and a permission check; this convention is written into doc 0004
section 7 by this item, and a test fails if the `(app)` layout stops calling it.

### 3. Sign-in page (`src/app/sign-in/page.tsx`, outside the app shell)

A server component. It first asks `isSetupNeeded()` (WS-016) and `redirect("/setup")`s if
the install is empty, then `getSession()` and `redirect("/")`s if already signed in, then
renders `SignInForm` with the validated return path.

`safeNextPath(value)` (`src/lib/next-path.ts`, pure): accepts only a string that starts
with a single `/`, contains no backslash, no control character and no `//` at the start, and
parses (with the app's origin as base) back to the same origin; anything else becomes `/`.

`SignInForm` (`src/components/sign-in-form.tsx`, client): email and password with the
existing `Input` and `Button`, native labels. It `POST`s `{ email, password }` to
`/api/v1/auth/sign-in`. `200`: `router.push(next)`, then `router.refresh()`. `401`: "Invalid
email or password." `429`: "Too many attempts. Try again in N minutes." from the
`Retry-After` header. `400` and anything else: a generic message. Under the form: "Forgot
your password? Ask an administrator for a reset link."

### 4. Account menu and sign-out

`AccountMenu` (`src/components/app-shell/account-menu.tsx`, client) in the shell header,
next to the theme toggle, built from the existing dropdown-menu component. It shows the
person's initial on its trigger and, inside, name, email and role, then "Sign out". Sign out
`POST`s `/api/v1/auth/sign-out`, then `router.replace("/sign-in")` and `router.refresh()`, so
the back button finds a page that redirects again (the proxy sees no cookie).
`AppShell` gains an `account` prop (the `AccountSummary` of WS-015), which the layout
supplies.

### 5. Keeping the session alive

A page render cannot set cookies, so Better Auth's cookie refresh (it extends a session
that is more than a day old, WT-02 decision 8) is lost when only server components read the
session. `AccountMenu` therefore calls `GET /api/v1/me` once when the shell mounts. That
route already forwards the refreshed cookie (WS-015). Every API route that authenticates
must do the same, which is the convention for WT-03 onward (the existing routes do).

### 6. End-to-end fixtures

The existing specs (`home`, `shell`) now need a session. A Playwright fixture
(`tests/e2e/fixtures.ts`) creates an account with `seedAccount`, signs in through
`POST /api/v1/auth/sign-in` with the page's own request context (so the cookie is shared
with the page), and hands the spec a signed-in `page`. `setup.spec.ts` stays on the empty
database and gains the checks of this item that need it.

## Files

| Path                                                                                      | Change                                 |
| ----------------------------------------------------------------------------------------- | -------------------------------------- |
| `src/proxy.ts`, `src/proxy.test.ts`                                                       | create (test first)                    |
| `src/lib/next-path.ts`, `next-path.test.ts`                                               | create (test first)                    |
| `src/server/auth/session.ts`, `session.integration.test.ts`                               | create (test first)                    |
| `src/app/sign-in/page.tsx`, `page.integration.test.ts`                                    | create (test first)                    |
| `src/components/sign-in-form.tsx`, `sign-in-form.test.tsx`                                | create (test first)                    |
| `src/components/app-shell/account-menu.tsx`, `account-menu.test.tsx`                      | create (test first)                    |
| `src/components/app-shell/app-shell.tsx`, `app-shell.test.tsx`                            | modify: `account` prop, the menu       |
| `src/app/(app)/layout.tsx`, `layout.integration.test.ts`                                  | modify: `requireAccount()`; guard test |
| `tests/e2e/fixtures.ts`, `home.spec.ts`, `shell.spec.ts`, `setup.spec.ts`, `auth.spec.ts` | create / modify                        |
| `docs/canonical/0004-api-conventions.md` section 7                                        | modify: pages, proxy and data          |
| `README.md`                                                                               | modify: first visit leads to `/setup`  |
| `docs/README.md`, WT-02, WI-017, WS-017                                                   | statuses                               |

No new dependencies, no migration, no API change.

## Data model changes

None.

## API contract

None. The pages use the existing `sign-in`, `sign-out` and `me` operations.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                                                                           | Criterion        |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| 1   | unit        | `safeNextPath` keeps `/`, `/projects/1?tab=a`; rejects `//evil.com`, `/\evil.com`, `https://evil.com`, `javascript:alert(1)`, `""`, `undefined`, arrays, control characters, and returns `/` for them                          | return path      |
| 2   | unit        | proxy: a page request with no session cookie redirects to `/sign-in?next=` with the path and query encoded; with either cookie name it passes through; `/sign-in`, `/setup`, `/api/...` are excluded by the matcher            | proxy            |
| 3   | unit        | `SignInForm`: posts `{ email, password }`; `200` pushes the return path and refreshes; `401` shows the generic message; `429` shows the wait from `Retry-After`; the button is disabled while sending; the reset hint is shown | form             |
| 4   | unit        | `AccountMenu`: shows the initial; opens to name, email and role; "Sign out" posts to the API and then replaces the route with `/sign-in`; it calls `GET /api/v1/me` once on mount                                              | menu, keep-alive |
| 5   | unit        | `AppShell` renders the menu for the account it is given; the existing shell tests still pass                                                                                                                                   | shell            |
| 6   | integration | `getSession()`: a valid cookie gives the account; no cookie, expired, deleted and deactivated give `null`; `requireAccount()` redirects to `/sign-in` for those                                                                | verification     |
| 7   | integration | the `(app)` layout source calls `requireAccount()` (guard test); the layout redirects when called without a session                                                                                                            | verification     |
| 8   | integration | `/sign-in` page: redirects to `/setup` on an empty install; redirects to `/` when signed in; renders otherwise and passes a sanitised return path                                                                              | sign-in page     |
| 9   | e2e         | on the empty install: `/` ends at `/setup`; after setup, sign out leads to `/sign-in` and the back button does not show the app                                                                                                | setup, sign-out  |
| 10  | e2e         | wrong password shows the error; the right one shows the app with the account menu; opening `/` signed out and signing in returns to the page asked for                                                                         | sign-in          |
| 11  | e2e         | `/api/v1/health`, `/api/v1/openapi.json` and `/setup` stay reachable without a session; the existing home and shell specs pass with the signed-in fixture                                                                      | nothing breaks   |
| 12  | e2e         | the session cookie's expiry is pushed forward after the shell loads on a session that is more than a day old (the keep-alive ping)                                                                                             | keep-alive       |
| 13  | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`                                                                                                                                                                        | gate             |

## Risks and open questions

For the owner:

1. **Keeping the session alive with a ping.** The cookie of a session is only refreshed when
   the API answers; a page render cannot set one. Without a remedy, the cookie would expire 7
   days after sign-in however much the person used the app. I propose the one `GET
/api/v1/me` the account menu sends when the shell mounts (a full page load), plus the
   rule that every authenticated API route forwards the cookie headers. Agree? The
   alternative is to accept that people sign in again every 7 days.
2. **Return to the page asked for.** After signing in the person goes back to the page they
   first asked for, through a `next` parameter that is strictly limited to paths inside the
   app (test 1). This is a classic open-redirect risk if it is wrong, which is why it has its
   own tests. Keep it, or always land on `/`?
3. **Where authentication of pages lives.** Proxy for the cheap cookie check, the `(app)`
   layout for the real one, and the API for data. Any future server component that reads
   data itself must call `requireAccount()` and a permission check, a rule I add to doc 0004
   section 7. Agree?

Technical, settled by the tests:

4. **`headers()` in `getSession()`.** Building a `Request` from the incoming headers for
   `authenticate` is taken from the installed Next.js documentation; if a server component
   cannot read the cookie that way, I stop and report.
5. **Test 12** may be hard to make deterministic (it needs a session older than a day). It
   backdates the session row in the end-to-end database before loading the page; if that
   proves unreliable it is replaced by an integration test of the same `me` route, which
   WS-015 already covers, and I say so in the implementation record.
