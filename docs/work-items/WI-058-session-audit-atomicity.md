# WI-058 — A session change and its audit entry stand or fall together

- Status: Done
- Work-track: none: a hardening item from the audit of 2026-11-17 (finding A07)
- Depends on: WI-057 (merged; its `signInAfterCommit` catches the errors this item makes
  clean)
- Work-spec: [WS-058](../work-specs/WS-058-session-audit-atomicity.md)

## Outcome

Today sign-in creates the session through Better Auth, then, in a separate transaction,
writes `last_seen_at` and the `auth.sign_in` audit entry. If that transaction fails, the
caller gets `500` but the session row stays, without its audit entry. Sign-out deletes the
session through Better Auth, then writes `auth.sign_out` on its own; if that write fails,
the person is signed out but nothing records it. Better Auth's sign-out also swallows a
failed delete, so the audit can say "signed out" while the session still works.

A sign-in can also race a password change: it checks the old password, the change commits
and deletes the account's sessions, then the sign-in's session is inserted, and it outlives
the change.

After this item:

- a sign-in answers success only when its session, `last_seen_at` and audit entry are all
  written; when the audit write fails, the new session is deleted again and no cookie is
  sent;
- sign-out deletes the session and writes its audit entry in one transaction;
- a sign-in that meets a password change made while it was in flight is refused, and its
  session is deleted;
- the guarantee that remains (a crash between two steps) is written down.

## Acceptance criteria

- [x] When the `auth.sign_in` audit write fails, sign-in answers `500`, sends no
      `Set-Cookie`, and leaves no session row for the attempt and no `last_seen_at` change.
- [x] When removing that session also fails, the error is still answered as `500`, and one
      log line without the error's message (WS-042) says a session may remain.
- [x] Sign-out deletes the caller's session row and writes `auth.sign_out` in one
      transaction: when the audit write fails, it answers `500` and the session still
      works; when it succeeds, the row is gone and the cookie is cleared.
- [x] A sign-in whose session is created while a password change (accepting a link,
      changing one's own password) is committing ends with no session that survives the
      change: it is refused with `401` when the change committed first, and its session is
      deleted by the change otherwise.
- [x] Changing one's own password takes the per-account lock, as accepting a link already
      does.
- [x] The guarantee is documented: what is atomic, and what a crash between Better Auth's
      insert and the audit transaction can leave behind.
- [x] No API contract changes. The full quality gate passes.

## Notes

Deactivation and role changes need no new rule: every request re-reads the account
(`authenticate`), so a session made just before a deactivation cannot be used, and the role
always comes from the account row (WS-058, section 5).
