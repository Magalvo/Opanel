# WI-019 — Accepting an invitation or reset link: set a password (API and page)

- Status: Approved (by the owner on 2026-11-13)
- Work-track: [WT-02](../work-tracks/WT-02-accounts-and-permissions.md)
- Depends on: [WI-018](WI-018-account-management-api.md)
- Work-spec: [WS-019](../work-specs/WS-019-accept-invitation-or-reset-link.md)

## Outcome

A person who holds a one-time link, an invitation or a password reset an Admin generated
for them (WI-018), can open it, choose a password, and is signed in. This closes the loop of
WT-02 decisions 5 and 6: an Admin can invite someone, and that someone can actually get in;
a person who forgot their password can get back in with the help of an Admin.

The link is read in the browser from the part of the address after `#`, which a browser never
sends to a server, and is sent once, in the body of a request, when the password is chosen.

## Acceptance criteria

- [ ] `POST /api/v1/account-links/accept` with a valid token and a password that follows the
      rule of WT-02 decision 7 sets that password, marks the link used, and answers `200`
      with the account and a session cookie, so the person is signed in.
- [ ] An invitation sets the first password of an invited account; a reset link replaces the
      password of an active one, and the old password stops working.
- [ ] A link works exactly once. A second use, an expired link, an unknown token, a link that
      an Admin replaced with a newer one, and a link of a deactivated account all get the
      same `404` (code `invalid_link`), so the answer does not say which it was. When many
      requests use the same link at the same moment, exactly one succeeds.
- [ ] Accepting a link ends every earlier session of that account (WT-02 decision 7), and
      the new session is the only one left.
- [ ] The password, the link's `used_at`, the sessions and the audit entry are written in one
      transaction: if any part fails, the link stays usable and nothing else changed.
- [ ] Success is audited with the account as actor: `account.invitation_accepted` for an
      invitation, `account.password_changed` (via a reset link) for a reset, followed by the
      sign-in. Failed attempts write no audit row, so an anonymous caller cannot grow the
      append-only log (the lesson of WI-022).
- [ ] Where a client address is configured, attempts are limited per address (`429` with
      `Retry-After`); the counters are bounded like the sign-in ones.
- [ ] Invalid input is `400` per field and never echoes the password; a foreign `Origin` is
      `403` before the body is read; a non-JSON body is `415`.
- [ ] No password, hash, token or session token appears in any response, log line or audit
      entry.
- [ ] `/accept` is a public page that reads the token from the address fragment, removes the
      fragment from the address bar at once, shows a password form (with confirmation,
      checked in the browser and never sent), and on success loads the app. A missing or
      refused token shows one clear message and no form.
- [ ] The operation is public by declaration of the work-spec, is in the generated OpenAPI
      document, and `docs/api/openapi.json` is regenerated.
- [ ] End to end, in a browser: an Admin invites a person; the person opens the link, sets a
      password and is in the app; the same link is then refused; after an Admin issues a reset
      link, the person sets a new password and the old one no longer signs in.
- [ ] The full quality gate passes.

## Notes

Not in this item: the People page where an Admin sees and copies links (WI-020), changing
one's own password while signed in (WI-021), any email (there is none in v1). A link is
still shown to the Admin only when it is issued, as in WI-018.
