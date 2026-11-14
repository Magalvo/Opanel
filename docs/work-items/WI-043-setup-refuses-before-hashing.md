# WI-043 — First-run setup refuses before hashing

- Status: Done
- Work-track: [WT-03](../work-tracks/WT-03-board-core.md) (found in the audit of 2026-11-14,
  finding A-01; the code it touches was built in WT-02)
- Depends on: none
- Work-spec: [WS-043](../work-specs/WS-043-setup-refuses-before-hashing.md)

## Outcome

On an install that already has accounts, `POST /api/v1/setup` answers `404` without
computing an Argon2 hash. Today the hash is computed first, so anyone can make an
installed server do that work with a well-formed body, and no limiter sits on that path.

## Acceptance criteria

- [x] With any account present (human, agent, deactivated), setup answers `404` and the
      password hasher is not called.
- [x] On an empty install the first Admin is still created, with credential and audit
      entries, exactly as before.
- [x] Concurrent setups still create exactly one account; the check inside the transaction
      still decides.
- [x] An account created between the first look and the transaction still yields `404` and
      writes nothing.
- [x] No endpoint, body or status code changes.
- [x] The full quality gate passes.

## Notes

Protecting an install that is still empty (`SETUP_TOKEN`, a limiter) is a separate,
already recorded follow-up and stays out of this item.
