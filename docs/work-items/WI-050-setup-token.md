# WI-050 — Optional setup token for the first-run setup

- Status: Approved
- Work-track: [WT-04](../work-tracks/WT-04-realtime-board-sync.md) (amendment A1, decision 13)
- Depends on: none
- Work-spec: [WS-050](../work-specs/WS-050-setup-token.md)

## Outcome

An operator can keep a freshly deployed install from being claimed by whoever reaches it
first. Today the first visitor to `/setup` becomes the Admin (WS-016, question 1). After
this item, if the optional `SETUP_TOKEN` environment variable is set, the setup page asks
for it and `POST /api/v1/setup` refuses without it, before any password is hashed and
before anything is written. If it is not set, setup works exactly as today.

## Acceptance criteria

- [ ] `SETUP_TOKEN` is optional. When it is set, it must be 32 to 256 characters; a shorter
      or longer value stops the server at start-up with a message that never contains the
      value. Unset or empty means "no token".
- [ ] With a token set, the setup page shows a "Setup token" field. Without one, the page
      is unchanged.
- [ ] With a token set, a request with a missing or wrong `setupToken` answers
      `403 invalid_setup_token`, the same for both, and computes no Argon2id hash, creates
      no account and writes no audit entry. The right token creates the first Admin as
      today.
- [ ] An installed server still answers `404` before the token is looked at (WI-043).
- [ ] Without a token set, setup is unchanged, including when a client sends a
      `setupToken`.
- [ ] The token is compared in constant time and never appears in a log line, an audit
      entry or a response.
- [ ] The OpenAPI document shows the optional `setupToken` field and the new `403`; canonical
      doc 0004 lists `invalid_setup_token`.
- [ ] `.env.example` and `README.md` tell the operator when and how to set `SETUP_TOKEN`.
- [ ] The full quality gate passes.

## Notes

Recommended in WS-016 (question 1), kept as a follow-up, and scheduled before the first
usable release by the owner in WS-043 (question 2). Joined WT-04 as amendment A1, approved
on 2026-11-17, and is the first item of the track.
