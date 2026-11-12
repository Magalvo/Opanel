# WI-022 — Sign-in hardening: bounded audit and limiter growth

- Status: Proposed (awaiting owner approval)
- Work-track: [WT-02](../work-tracks/WT-02-accounts-and-permissions.md)
- Depends on: WI-015
- Work-spec: [WS-022](../work-specs/WS-022-sign-in-hardening.md)

## Outcome

Someone who is not signed in can no longer make Opanel write without limit. Today every
failed sign-in, including every attempt the limiter refuses, adds a row to `audit_log`,
which is append-only and can never be trimmed. With `CLIENT_IP_HEADER` unset (the default)
the only limit is per email, so varying the email fills the table as fast as requests can
be sent. Found in the review of 2026-11-12.

After this item the audit log still records that sign-ins are failing and that the limiter
is refusing someone, but the number of rows an anonymous caller can cause is capped.

## Acceptance criteria

- [ ] A sign-in refused by the limiter is audited once per limiter key and window, on the
      first refusal. Further refusals in that window write no audit row.
- [ ] Failed sign-ins that are audited share one install-wide budget per 15 minutes. When
      the budget is used up, further failures in that window write no audit row, and the
      last row written says that more were suppressed.
- [ ] The budget never changes the response: a suppressed failure gets the same `401` or
      `429`, with the same body and headers, as an audited one.
- [ ] Successful sign-ins, sign-outs and every other audited action are never suppressed.
- [ ] Limiter counters are deleted once their window has ended, not a day later.
- [ ] In production, starting the server without `CLIENT_IP_HEADER` logs one warning that
      sign-in is limited per email only. It does not stop the server.
- [ ] The full quality gate passes.

## Notes

Out of scope, on purpose: a cap on all sign-in attempts across the install. It would let
anyone lock every user out by sending junk attempts, which is worse than the cost it
removes. See the question in WS-022.

The 15-minute lock-out of one email by a third party is a known, accepted trade-off
(WS-015, question 2) and is not changed here.
