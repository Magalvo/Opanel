# WI-057 — A set password is never reported as a failure

- Status: Done
- Work-track: none: a hardening item from the audit of 2026-11-17 (finding A06)
- Depends on: WI-056 (its `429 server_busy` is one of the failures handled here; the branch
  is stacked on it)
- Work-spec: [WS-057](../work-specs/WS-057-committed-password-recovery.md)

## Outcome

Accepting a link (`POST /api/v1/account-links/accept`) and the first-run setup
(`POST /api/v1/setup`) commit the password first, then sign the person in, outside that
transaction. If the sign-in fails, the request fails, although the password is already
set: the link is used, or the Admin exists. The forms then say "try again", and the retry
gets `404`. With WI-056 the sign-in can also meet a full hash gate (`429 server_busy`), so
this is no longer only a rare database error.

After this item a committed change is always answered as a success. When no session could
be made, the response says so (`signedIn: false`), and the form sends the person to the
sign-in page, which tells them their password is set. When the response itself is lost,
the forms' messages tell the person that the password may already be set and to try signing
in.

## Acceptance criteria

- [x] When signing in fails after the password was committed, accepting a link answers
      `200` and setup answers `201`, with the account, `signedIn: false` and no session
      cookie; the failure is logged without its message (WS-042), and no `auth.sign_in`
      audit entry is written.
- [x] When signing in works, both answer as today, with `signedIn: true`.
- [x] A refusal before the commit (`404`, `403`, `400`, `429` of the limiter or the gate,
      before hashing) is unchanged: nothing is committed and the error is returned.
- [x] On `signedIn: false` the accept form goes to `/sign-in?notice=password-set` and the
      setup form to `/sign-in?notice=admin-created`; the sign-in page shows the matching
      message, and ignores any other `notice` value.
- [x] The accept form's `404` message and its message for a network error or `5xx` tell
      the person their password may already be set and to try signing in; the setup form's
      say the same for the administrator.
- [x] The contracts and the generated OpenAPI document describe `signedIn`.
- [x] The full quality gate passes.

## Notes

The audit's other option, a separate session-creation path that proves link ownership, is
not taken (WS-057, "Considered and not chosen").
