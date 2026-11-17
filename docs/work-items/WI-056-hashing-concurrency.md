# WI-056 — Password hashing cannot starve the server

- Status: Done
- Work-track: none: a hardening item from the audit of 2026-11-17 (finding A03, the part
  left after WI-043, WI-044 and WI-055)
- Depends on: none
- Work-spec: [WS-056](../work-specs/WS-056-hashing-concurrency.md)

## Outcome

Every Argon2id hash and verification goes through `src/server/auth/password.ts`, and runs
on Node's shared libuv threadpool (4 threads by default), which file reads and DNS lookups
also use. Nothing limits how many wait. Sign-in is public, and without `CLIENT_IP_HEADER`
it is limited per email only, so a caller who varies the email can queue as many hashes as
it likes. Measured on 2026-11-17: one hash takes 24 ms; behind 64 queued hashes, a file
read waited 980 ms.

After this item at most a fixed number of Argon2id operations run at once, a bounded
number wait, and any request beyond that is refused at once with `429 server_busy` and a
`Retry-After`, before it reaches the threadpool. Other work keeps threads of its own.

## Acceptance criteria

- [x] At most 2 Argon2id operations (hash or verify, from any caller, Better Auth's
      included) run at the same time in one server process.
- [x] At most 32 more wait, in arrival order; a request that would be the 33rd waiting is
      refused with `429`, code `server_busy`, `Retry-After: 1`, without hashing.
- [x] A failing or rejected operation always frees its place.
- [x] Sign-in, first-run setup, accepting a link and changing one's password answer that
      `429` through their routes; their contracts document it; the OpenAPI document is
      regenerated.
- [x] The setup form shows the "wait and try again" message for a `429`, as the sign-in,
      accept and profile forms already do.
- [x] With the gate in place, a file read during a flood of 64 hashes waits about as long as
      with none (measured and recorded, not asserted in a test).
- [x] The full quality gate passes.

## Notes

Not in this item: a per-install sign-in limiter (it would let one caller lock everyone
out, as the audit warns), and the link-acceptance limiter without a client address (an
unknown link is refused before any hash since WI-040, so it costs no Argon2id).
