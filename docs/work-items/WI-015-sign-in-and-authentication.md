# WI-015 — Sign-in, sign-out, `GET /api/v1/me`, request authentication, sign-in limiter

- Status: Approved (by the owner on 2026-11-12)
- Work-track: [WT-02](../work-tracks/WT-02-accounts-and-permissions.md)
- Depends on: [WI-011](WI-011-api-foundations.md), [WI-014](WI-014-audit-log.md)
- Work-spec: [WS-015](../work-specs/WS-015-sign-in-and-authentication.md)

## Outcome

A person with an account can sign in over the API with email and password, is recognised
on later requests through a session cookie, can ask who they are, and can sign out. Every
other endpoint added from now on can authenticate a request with one function. Guessing
passwords is slowed by a rate limiter, and every sign-in, failed sign-in and sign-out is in
the audit log.

This is the first item with real endpoints: three of them, plus the shared request
authentication and the cross-site check of canonical doc 0004 section 7. No page is added
(WI-017), and there is still no way to create the first account through the app (WI-016),
so tests create accounts directly.

## Acceptance criteria

- [ ] `POST /api/v1/auth/sign-in` with a correct email and password returns `200` with the
      account's id, name, email, kind and role, and sets a session cookie that is
      `HttpOnly`, `SameSite=Lax`, and `Secure` when the app's URL is `https`.
- [ ] A wrong password, an unknown email and a deactivated account all get the same `401`
      response, so the response does not reveal whether the email exists.
- [ ] After the allowed number of attempts, further attempts get `429` with `Retry-After`,
      per email and per client address; the counters live in PostgreSQL, are updated
      atomically under concurrent requests, and a successful sign-in is not blocked by
      other people's attempts.
- [ ] `GET /api/v1/me` with a valid session returns the signed-in account and its
      permissions; without one, or with an expired session, a deactivated account or an
      `Authorization` header, it returns `401`.
- [ ] `POST /api/v1/auth/sign-out` ends the session (the row is deleted, the cookie is
      cleared, `204`); the old cookie no longer authenticates.
- [ ] A state-changing request that carries no `Authorization` header and whose `Origin`
      is not the app's own origin is rejected with `403`, before any work is done.
- [ ] One function authenticates any request into an `Actor`; it is the only place that
      reads the cookie.
- [ ] Sign-in, failed sign-in (no actor, with a reason and without the email) and sign-out
      are recorded in the audit log, in the same transaction as the change they describe
      wherever Opanel owns the change.
- [ ] No password, hash, session token or cookie value appears in any response body, log
      line or audit entry.
- [ ] The three operations are in the generated OpenAPI document with their request and
      response schemas, and `docs/api/openapi.json` is regenerated.
- [ ] End-to-end: sign in, `me`, sign out, `me` again, against the running production
      build.
- [ ] The full quality gate passes.

## Notes

Not in this item: agent API tokens (WT-05; any `Authorization` header is answered `401`
until then, as canonical doc 0004 says a header means "token only"), the first-run setup
(WI-016), invitations and password reset links (WI-018, WI-019), ending sessions when an
account is deactivated or its role changes (WI-018), changing one's own password (WI-021).
