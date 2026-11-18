# WI-065 — `recover-admin`: an operator command to get back in

- Status: Done
- Work-track: [WT-12](../work-tracks/WT-12-operations.md) (item D)
- Depends on: WI-062 (merged: the image and its one-shot commands)
- Work-spec: [WS-065](../work-specs/WS-065-recover-admin.md)

## Outcome

Today only an Admin can create a reset link (WT-02 decision 6). If the only Admin loses
their password, nobody can get back in: the follow-up "No way back in if the only Admin
loses their password" in `docs/README.md`, open since the review of 2026-11-12, and audit
finding A12.

After this item, an operator with access to the server runs, from the image,
`node dist/recover-admin.mjs --email <email>` (in development `pnpm admin:recover --email
<email>`). For a human Admin account that is not deactivated, it issues a link exactly as
"Create reset link" does (an invitation link if the Admin never set a password), prints it
once, and writes the audit entry with no acting account and `via: "operator"`. It refuses
any other account, and it is never reachable over HTTP.

## Acceptance criteria

- [x] For an active Admin, the command prints a reset link (`<APP_URL>/accept#<token>`) and
      its expiry, exits `0`, and the link sets a new password through the normal accept
      page.
- [x] For an invited Admin (no password yet), it prints an invitation link.
- [x] Earlier unused links of that account stop working (one unused link, WS-059).
- [x] `account.reset_link_created` is recorded with no acting account and
      `data: { kind, via: "operator" }`; the token is in no audit entry or log line.
- [x] An unknown email, a non-Admin account and a deactivated Admin are refused with a
      message saying which, exit `1`, and nothing is written.
- [x] A missing or malformed `--email` prints the usage and exits `2`.
- [x] No HTTP endpoint, page or API contract changes.
- [x] The production smoke test runs it against the example install.
- [x] The README follow-up is marked as answered by this item.
