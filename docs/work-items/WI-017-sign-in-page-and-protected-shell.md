# WI-017 — Sign-in page, protected app shell, account menu with sign-out

- Status: Approved (by the owner on 2026-11-12)
- Work-track: [WT-02](../work-tracks/WT-02-accounts-and-permissions.md)
- Depends on: [WI-015](WI-015-sign-in-and-authentication.md), [WI-016](WI-016-first-run-setup.md)
- Work-spec: [WS-017](../work-specs/WS-017-sign-in-page-and-protected-shell.md)

## Outcome

The web app stops being open to the world. A visitor who is not signed in is sent to a
sign-in page; a signed-in person sees the app shell with their name in an account menu and
can sign out from it. A visitor to an install that has no accounts yet is led to `/setup`,
which closes the loop WI-016 left open.

The pages use the same `/api/v1` endpoints as everyone else (`AGENTS.md` section 3). No
endpoint is added.

## Acceptance criteria

- [ ] A request for an app page without a session cookie is redirected to `/sign-in`
      before the page is rendered, and the page's address is remembered so that signing in
      returns to it.
- [ ] The return address is only ever a path inside the app: anything else (another site,
      `//host`, a backslash trick, a non-path) is ignored and the person lands on `/`.
- [ ] `/sign-in` shows an email and password form. A correct sign-in takes the person to
      the app; a wrong one shows one generic message that does not say which part was
      wrong; a rate-limited one says to wait and for how long.
- [ ] A person who is already signed in and opens `/sign-in` is sent to `/`.
- [ ] A visitor to `/sign-in` on an install with no accounts is sent to `/setup`.
- [ ] The app shell verifies the session itself, with the database, not only the cookie's
      presence: an expired, deleted or deactivated session leads to `/sign-in` too.
- [ ] The app shell header has an account menu that shows the person's name, email and
      role, and a "Sign out" item. Signing out ends the session through the API and leads
      to `/sign-in`; the browser's back button does not show the app again.
- [ ] Using the app keeps the session alive (WT-02 decision 8), even though a page render
      cannot set a cookie.
- [ ] No API route and no page of the existing set breaks: health, OpenAPI document and
      `/setup` stay reachable without a session.
- [ ] End to end, in a browser: a fresh install sends `/` to `/setup`; after setup, signing
      out leads to `/sign-in`; signing in with the wrong password shows the error, with the
      right one shows the app; opening an app page while signed out returns to it after
      sign-in.
- [ ] The full quality gate passes.

## Notes

Not in this item: changing one's own name or password (WI-021), the People page (WI-020),
resetting a forgotten password (WI-019: there is no email, so the sign-in page only tells
the person to ask an administrator).
