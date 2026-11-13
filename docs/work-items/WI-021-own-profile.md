# WI-021 — Own profile: change name and password

- Status: Done (approved by the owner on 2026-11-13)
- Work-track: [WT-02](../work-tracks/WT-02-accounts-and-permissions.md)
- Depends on: [WI-017](WI-017-sign-in-page-and-protected-shell.md)
- Work-spec: [WS-021](../work-specs/WS-021-own-profile.md)

## Outcome

Any signed-in person, whatever their role, can correct the name others see and change their
own password, without asking an Admin. Changing the password signs out the person's other
sessions (WT-02 decision 7) and keeps the one they are using. This is the last open item of
WT-02's scope ("changing one's own name and password").

## Acceptance criteria

- [x] `PATCH /api/v1/me` with `{ name }` changes the caller's name and answers `200` with the
      same body as `GET /api/v1/me`. It needs a session and no permission, so a Viewer can
      use it. The name follows the invitation rule (trimmed, 1 to 100 characters).
- [x] `POST /api/v1/me/password` with `{ currentPassword, newPassword }` replaces the
      caller's password and answers `204`. The new password follows WT-02 decision 7 (12 to
      128 characters). The old password stops working and the new one signs in.
- [x] A wrong current password is `400` with a field error on `currentPassword`, not `401`,
      so the client does not take it for an expired session. Nothing changes.
- [x] A successful password change ends every other session of the account and keeps the
      session that made the request. The credential, the sessions and the audit entry are
      written in one transaction.
- [x] Password change attempts are limited per account (`429` with `Retry-After`), so a
      stolen session cannot be used to guess the password. The counters are bounded like the
      others.
- [x] Audited with the caller as actor: `account.name_changed` (only when the name really
      changes) and `account.password_changed` with `data: { via: "self" }`. Failed attempts
      write no audit row.
- [x] Both operations reject a foreign `Origin` (`403`) before the body is read, a non-JSON
      body (`415`), unknown fields (`400`), and no session (`401`). No password, hash or
      session token appears in any response, log line or audit entry.
- [x] Both are in the generated OpenAPI document as authentication-only operations, and the
      WS-023 guard-rail list of authentication-only operations is extended by exactly these
      two.
- [x] A "Profile" item in the account menu opens `/profile`, a page in the app shell with two
      forms: name, and password (current, new, confirmation checked in the browser and never
      sent). Each shows success, field errors and rate limiting. After a name change the
      shell shows the new name.
- [x] End to end, in a browser: a Member changes their name and sees it in the account menu;
      changes their password; a second browser signed in as the same person is signed out;
      the old password no longer signs in and the new one does.
- [x] The full quality gate passes.

## Notes

Not in this item: changing one's email (no email change exists in v1, see the follow-ups in
`docs/README.md`), self-service reset of a forgotten password (WT-02 decision 6), a list of
one's sessions, and anything for agent accounts (WT-05 decides what an agent may change
about itself; today any `Authorization` header is already `401`).
