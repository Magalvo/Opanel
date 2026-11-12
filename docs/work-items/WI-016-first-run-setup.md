# WI-016 — First-run setup: create the first Admin (API and page)

- Status: Approved (by the owner on 2026-11-12)
- Work-track: [WT-02](../work-tracks/WT-02-accounts-and-permissions.md)
- Depends on: [WI-015](WI-015-sign-in-and-authentication.md)
- Work-spec: [WS-016](../work-specs/WS-016-first-run-setup.md)

## Outcome

On a fresh install, whoever opens `/setup` can create the first Admin account with a name,
an email and a password, and is signed in as that Admin straight away. From that moment the
page and its endpoint do not exist any more: they answer `404`, forever. This is the only
way an account comes into being without an Admin's invitation (WT-02 decision 4).

## Acceptance criteria

- [ ] `POST /api/v1/setup` with a valid name, email and password creates one account with
      role `admin`, stores the password only as an Argon2id hash, and answers `201` with
      the account and a session cookie, as sign-in does.
- [ ] If any account exists, the endpoint answers `404` and creates nothing. This holds
      when many requests arrive at the same moment on an empty install: exactly one wins.
- [ ] The account, its credential and the audit entry are written in one transaction: if
      any part fails, none remains.
- [ ] The creation is recorded in the audit log (`setup.first_admin_created`), and so is
      the sign-in that follows it.
- [ ] Invalid input is a `400` with one entry per failing field and never echoes the
      password; the password follows the rule of WT-02 decision 7; a foreign `Origin` is a
      `403` and a non-JSON body a `415`.
- [ ] No password, hash or session token appears in any response body, log line or audit
      entry.
- [ ] `/setup` shows a form (name, email, password, confirmation) while the install has no
      accounts; submitting it creates the Admin and takes the person to the app. The
      confirmation is checked in the browser and never sent.
- [ ] `/setup` is a `404` page as soon as an account exists.
- [ ] The operation is public by declaration of the work-spec, appears in the generated
      OpenAPI document, and `docs/api/openapi.json` is regenerated.
- [ ] End to end, in a browser on a fresh database: open `/setup`, create the Admin, end up
      signed in, and then see `/setup` return `404`.
- [ ] The full quality gate passes.

## Notes

Not in this item: sending a visitor who opens `/` on an empty install to `/setup`, and
protecting the app pages (both WI-017, which owns the sign-in page and the redirect
logic); the README documents the `/setup` address until then. Invitations are WI-018 and
WI-019.
