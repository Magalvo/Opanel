# WI-024 — Revoke an invitation that was never accepted

- Status: Done (approved by the owner on 2026-11-13)
- Work-track: [WT-02](../work-tracks/WT-02-accounts-and-permissions.md)
- Depends on: [WI-018](WI-018-account-management-api.md), [WI-019](WI-019-accept-invitation-or-reset-link.md), [WI-020](WI-020-people-page.md)
- Work-spec: [WS-024](../work-specs/WS-024-revoke-invitation.md)

## Outcome

An Admin who invited a person by mistake, or to a mistyped email, can take the invitation
back. The invited account, which never had a password and never acted, is removed together
with its links, so its email is free to be invited again. An account whose invitation was
accepted cannot be revoked: it can only be deactivated, as before. This closes the planning
gap "an email can be neither corrected nor freed" recorded in `docs/README.md` on
2026-11-12, for the case it was found in.

## Acceptance criteria

- [x] `DELETE /api/v1/accounts/{accountId}/invitation` by an actor with `accounts:manage`
      removes a human account that has no password, with its links, and answers `204`. The
      same email can then be invited again.
- [x] An account that has a password (its invitation was accepted, whether it is active or
      deactivated now) is refused with `409` (code `conflict`) and nothing changes. An
      unknown id, or an agent account, is `404`.
- [x] A Viewer, Member or Manager gets `403`; no session gets `401`; a foreign `Origin` gets
      `403` before anything else is done.
- [x] Revoking and accepting the same invitation at the same moment never both succeed:
      either the person ends up with a working account, or the account is gone and the link
      is refused. Neither request fails with a server error.
- [x] Revoked with the Admin as actor, as `account.invitation_revoked`, in the same
      transaction as the removal. Earlier audit entries about the account stay.
- [x] An Admin with no password does not count as "another active Admin" for the
      last-Admin rule (WT-02 decision 9), so revoking an invited Admin can never leave the
      install without an Admin who can sign in.
- [x] On the People page, an invited person's row has a "Revoke invitation" action that asks
      for confirmation, says the email will be free again, and removes the row on success.
- [x] The operation is in the generated OpenAPI document and `docs/api/openapi.json` is
      regenerated.
- [x] End to end, in a browser: an Admin invites a person to a mistyped email, revokes the
      invitation from the People page, the old link is refused, and the same email can be
      invited again.
- [x] The full quality gate passes.

## Notes

Not in this item: changing the email of an account that has a password, deleting accounts
that have signed in, and recovering the only Admin's password (still open follow-ups in
`docs/README.md`).
