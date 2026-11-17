# WI-043 — First-run setup refuses before hashing

- Status: Done
- Work-track: none: a hardening item from the audit of 2026-11-14, done before WT-04
- Depends on: none (its branch is stacked on WI-042, for the status lines of the docs index)
- Work-spec: [WS-043](../work-specs/WS-043-setup-refuses-before-hashing.md)

## Outcome

`POST /api/v1/setup` is public. Today it computes the Argon2id hash of the password before it
checks whether the install already has accounts, so on an installed server anyone can make
it do expensive hashing, as often as they like, only to get `404`. After this item a setup
request on an installed server is refused with the same `404` before any hashing, while two
requests racing on an empty install still produce exactly one Admin.

## Acceptance criteria

- [x] When any account exists (active, deactivated or agent), the setup request gets `404`
      and no password is hashed.
- [x] On an empty install the first Admin is still created exactly as before, with one hash.
- [x] Concurrent requests on an empty install still create exactly one Admin; a request that
      loses the race after hashing gets `404` and creates nothing.
- [x] The endpoint's contract and answers do not change.
- [x] The full quality gate passes.

## Notes

Found by the audit of 2026-11-14 (finding A-01). An earlier version of this item exists on
the unmerged branch `claude/wi-043-setup-refuses-before-hashing`, written for older code;
this one replaces it. An empty install is still exposed: every request on it legitimately
hashes. The optional `SETUP_TOKEN` of the follow-ups is the fix for that (WS-043,
question 2).
