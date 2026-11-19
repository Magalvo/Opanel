# WI-070 — The operations guide, `docs/operations.md`

- Status: Approved (2026-11-19)
- Work-track: [WT-12](../work-tracks/WT-12-operations.md) (item I, the last)
- Depends on: WI-062 to WI-069 (everything the guide describes)
- Work-spec: [WS-070](../work-specs/WS-070-operations-guide.md)

## Outcome

WT-12 built every piece an operator needs (the image and example install, the two database
roles, the schema check, `recover-admin`, `maintenance`, HSTS and the example proxy, the
backup rehearsal, safe logs), but what an operator reads about them is one paragraph per
piece in `README.md`, "Running in production", which still says "The full operations guide
comes with WT-12".

After this item, `docs/operations.md` is the one guide doc 0006 asks for: an operator
installs Opanel behind their own HTTPS reverse proxy, upgrades it, backs it up and restores
it, gets back in, schedules maintenance, watches storage and handles logs by following it
alone. Each command in it is one CI runs (`smoke-production.sh`, `smoke-proxy.sh`,
`rehearse-backup.sh`) or says plainly that it is not. A test keeps the guide in step with
the image, the env file and the repository. WT-12 closes, and the Follow-ups of
`docs/README.md` that it answers are closed.

## Acceptance criteria

- [ ] `docs/operations.md` exists, linked from `README.md`, and covers, in this order:
      requirements and the one-process rule; install with `compose.production.yaml`
      (secrets, `SETUP_TOKEN`, the first-run setup); the reverse proxy (the Caddy example,
      and the nginx settings for the same four requirements of doc 0006 section 4);
      `CLIENT_IP_HEADER`; upgrade; backup and restore (with the example install and with
      the operator's own PostgreSQL); recovering the last Admin; maintenance; health and
      outages; storage growth; logs (what they contain, access, retention).
- [ ] Every command the guide gives for the example install is the one a CI script runs,
      apart from the project name; the commands CI does not run (the upgrade from a
      release, the nginx settings) are marked as not rehearsed.
- [ ] A Vitest test fails when the guide names a `dist/*.mjs` command the image does not
      ship, an environment variable `.env.production.example` and `src/server/env.ts` do
      not know, or a repository file or doc that does not exist.
- [ ] The storage query in the guide runs on the example install and lists `audit_log`,
      `task_events` and `comments` with their sizes.
- [ ] `README.md` "Running in production" is a short summary that links to the guide and
      no longer repeats it.
- [ ] WT-12's exit criteria are each ticked with the item or test that covers them; the
      upgrade criterion is recorded as covered by today's checks, with a Follow-up to
      rehearse a real upgrade after the first tagged release (WS-068, question 4). WT-12
      is `Done`.
- [ ] The Follow-up "No work-track covers production deployment" is closed, each of its
      questions (reverse proxy, HTTPS, `CLIENT_IP_HEADER`, request size, logs) answered by
      a section of the guide.
- [ ] No API contract change. The full quality gate and the image workflow pass.

## Notes

- Found while drafting this item and split out as WI-069: the logs of Better Auth and
  Next.js could hold a session token. The guide's logs section relies on WI-069.
- "Create the first Admin through a command run on the server" (WS-055, question 3) stays
  a Follow-up: the guide documents the setup token, which is what exists.
