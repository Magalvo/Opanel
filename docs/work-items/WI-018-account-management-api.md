# WI-018 — Account management API: list, invite, change role, deactivate, reactivate

- Status: Approved (by the owner on 2026-11-12)
- Work-track: [WT-02](../work-tracks/WT-02-accounts-and-permissions.md)
- Depends on: [WI-015](WI-015-sign-in-and-authentication.md)
- Work-spec: [WS-018](../work-specs/WS-018-account-management-api.md)

## Outcome

An Admin can manage the people of the install through the API: list them, invite a new
person, change someone's role, deactivate and reactivate accounts, and generate a one-time
link for someone who is invited or has forgotten their password. Every one of these
actions is checked against the `accounts:manage` permission, recorded in the audit log with
its actor, and protects the install against losing its last Admin.

This is the first list endpoint, so the cursor pagination of canonical doc 0004 section 5
is built here, as that doc planned.

No page is added (WI-020 builds the People page on top of this API), and the link cannot be
opened yet (WI-019 builds the page that accepts it).

## Acceptance criteria

- [ ] Only an actor holding `accounts:manage` (an Admin) can call any of the endpoints;
      Viewer, Member and Manager get `403`, an unauthenticated caller `401`, and
      state-changing calls from another origin `403`.
- [ ] `GET /api/v1/accounts` lists human accounts, 50 per page by default and 100 at most,
      with an opaque keyset cursor; each item shows id, name, email, role, status
      (`invited`, `active` or `deactivated`), creation time and last-seen time. Unknown
      query parameters, an out-of-range `limit` and a tampered cursor are `400`.
- [ ] `POST /api/v1/accounts` invites a person by name, email and role: it creates the
      account, with no password, and returns it together with a single-use link valid for
      7 days, shown exactly once. A second invitation for the same email is `409`.
- [ ] The link is stored only as a hash; it never appears in any list, log line or audit
      entry.
- [ ] `PATCH /api/v1/accounts/{accountId}` changes the role and/or deactivates or
      reactivates the account. Changing a role or deactivating ends that account's sessions
      immediately, in the same transaction as the change.
- [ ] The only active Admin cannot be demoted or deactivated, by anyone including
      themselves (`409`, code `last_admin`), even when two such requests race.
- [ ] `POST /api/v1/accounts/{accountId}/reset-link` returns a fresh single-use link for an
      invited or active account (`409` for a deactivated one) and invalidates that
      account's earlier unused links.
- [ ] Agent accounts are not listed and cannot be reached through these endpoints.
- [ ] Each state change is audited with the acting Admin: `account.invited`,
      `account.role_changed` (from and to), `account.deactivated`, `account.reactivated`,
      `account.reset_link_created`; a change that changes nothing writes nothing.
- [ ] The five operations are in the generated OpenAPI document and
      `docs/api/openapi.json` is regenerated.
- [ ] End to end, through the running app: an Admin invites a person, changes their role,
      is refused when trying to demote the last Admin, and deactivating a signed-in person
      makes their next request `401`.
- [ ] The full quality gate passes.

## Notes

Not in this item: accepting a link and choosing a password (WI-019), the People page
(WI-020), changing one's own name or password (WI-021), agent accounts (WT-05), deleting
accounts (never in v1: accounts are deactivated).
