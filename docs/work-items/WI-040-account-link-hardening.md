# WI-040 — Account link hardening

- Status: Proposed (awaiting owner approval)
- Work-track: [WT-03](../work-tracks/WT-03-board-core.md) (found in the audit of 2026-11-13;
  the code it touches was built in WT-02)
- Depends on: none
- Work-spec: [WS-040](../work-specs/WS-040-account-link-hardening.md)

## Outcome

Three small defects in the invitation and reset-link flow are closed. None is exploitable
to read or change data; each costs either server time or a confusing answer.

1. Accepting a link computes the slow password hash before it looks at the token, so anyone
   can make the server do that work with a made-up token.
2. Issuing a new link and accepting the previous one at the same moment can, rarely,
   deadlock (the follow-up recorded by WS-024).
3. A person whose email is currently blocked by the sign-in limiter accepts their link, the
   password is set, and they are told "too many attempts" instead of being signed in.

## Acceptance criteria

- [ ] A request to accept a link whose token is unknown, used, expired, replaced or belongs
      to a deactivated account is refused without the password being hashed.
- [ ] The refusal is still the same `404` for all of those cases, and a valid link still
      works exactly once under concurrent requests.
- [ ] Issuing a link takes the per-account lock first; issuing and accepting for the same
      account at the same time both finish, with no deadlock, and at most one link works
      afterwards.
- [ ] Accepting a valid link signs the person in even when the sign-in limiter is currently
      refusing that email. The same holds for the sign-in at the end of first-run setup.
- [ ] That sign-in does not reset or bypass the limiter for ordinary sign-in attempts.
- [ ] No endpoint, response body or status code changes otherwise.
- [ ] The full quality gate passes.

## Notes

Small and independent of the board work: it can be done before or between the items of
WT-03.
