# WI-020 — Admin "People" page

- Status: Approved (by the owner on 2026-11-13)
- Work-track: [WT-02](../work-tracks/WT-02-accounts-and-permissions.md)
- Depends on: [WI-017](WI-017-sign-in-page-and-protected-shell.md), [WI-018](WI-018-account-management-api.md)
- Work-spec: [WS-020](../work-specs/WS-020-people-page.md)

## Outcome

An Admin can manage the people of the install from the browser, with no `curl`: see everyone
and their status, invite a person and copy the link to send them, change someone's role,
deactivate and reactivate accounts, and generate a fresh link for someone who is invited or
has lost their password. It is the screen on which WT-02's goal, "an Admin can bring people
in, change their role and deactivate them", is finally something a person can do.

The page is a client of the API of WI-018 and adds no endpoint (`AGENTS.md` section 3: the web
UI consumes the same `/api/v1` endpoints agents use).

## Acceptance criteria

- [ ] A "People" item in the sidebar and the `/people` page exist for an actor who holds
      `accounts:manage`. For anyone else the item is absent and `/people` is a `404` page.
- [ ] The page lists the install's human accounts, oldest first, 50 at a time with a "Load
      more" control, each with name, email, role, a status (invited, active or deactivated)
      and when the person was last seen.
- [ ] While loading it shows a placeholder; if loading fails it says so and offers to retry.
- [ ] An Admin can invite a person (name, email, role). The invitation's link is then shown in
      a dialog with a "Copy link" control, together with its expiry and a notice that it is
      shown only once. Closing the dialog discards the link from the page.
- [ ] The invite dialog says that the email cannot be changed afterwards.
- [ ] An Admin can change a person's role from the list. The result of the API is shown: the
      row updates on success; a refusal because the person is the only active Admin is
      explained in plain words.
- [ ] An Admin can deactivate and reactivate an account. Deactivating, and any change to the
      Admin's own account, asks for confirmation and says what it does (ends the person's
      sessions).
- [ ] An Admin can generate a new link for an invited account (a new invitation) or an active
      one (a password reset); not for a deactivated one. It is shown like an invitation's.
- [ ] If an Admin changes their own role away from Admin, or deactivates themselves, they are
      taken to the sign-in page, because their session has ended.
- [ ] Every action reports its outcome in text that assistive technology announces; dialogs
      trap and return focus; the table and its controls are usable by keyboard.
- [ ] The page works at phone width without horizontal page scroll, in light and dark themes.
- [ ] End to end, in a browser: an Admin opens People, invites a person and reads the link,
      changes their role, deactivates and reactivates them; a Member does not see the item and
      gets a `404` at `/people`.
- [ ] The full quality gate passes.

## Notes

Not in this item: changing or freeing an email, or revoking an invitation that was never
accepted. There is no API for it (accounts are never deleted in v1), and adding one is a
separate work-item, proposed in WS-020. Search, filters and sorting of the list (the list is
small by nature in a self-hosted install), live updates between Admins (WT-04), agent
accounts (WT-05). Own profile is WI-021.
