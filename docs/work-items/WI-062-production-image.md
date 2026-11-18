# WI-062 — Production image, example Compose file and `migrate`

- Status: Done
- Work-track: [WT-12](../work-tracks/WT-12-operations.md) (item A)
- Depends on: WT-04 (done)
- Work-spec: [WS-062](../work-specs/WS-062-production-image.md)

## Outcome

Today Opanel runs only from a checkout with every development dependency (`pnpm dev`, or
`next build` then `next start`), and migrations need `tsx`, a development dependency.
`compose.yaml` is for development and CI only (doc 0006 section 1).

After this item:

- a `Dockerfile` builds one production image: Node.js 22, the pinned pnpm, production
  dependencies only, the built app, a non-root user and a health check;
- the same image runs the app and, as a one-shot command, the migrations, without `tsx`;
- `compose.production.yaml` is an example install: PostgreSQL, a `migrate` service that
  runs once and exits, then the app, published on the host's loopback only, for the
  operator's reverse proxy;
- CI builds the image and checks that the example install starts, migrates, reports
  healthy and refuses the first-run setup without the setup token.

## Acceptance criteria

- [x] `docker build .` produces an image whose app process runs as a non-root user and
      contains no development dependency (no `tsx`, `vitest`, `playwright`, `drizzle-kit`).
- [x] `migrate` in that image applies every migration to an empty database and exits `0`;
      run again, it applies nothing and exits `0`; with an unreachable database it exits
      non-zero with a message and no secret.
- [x] The app does not start before `migrate` has succeeded (Compose `depends_on`), and
      a bad environment stops the container with the validation message (WS-003).
- [x] With `compose.production.yaml` and an env file holding the required variables,
      `GET /api/v1/health` answers `200`, and the image's health check reports healthy.
- [x] `POST /api/v1/setup` on that install answers `403` without the setup token
      (WS-055), and the app is published on `127.0.0.1` only.
- [x] `.dockerignore` keeps `.env*` (but the examples), `node_modules`, `.next`, `.git`,
      test output and `.claude/` out of the build context.
- [x] A CI job builds the image and runs the checks above on every change to the files
      the image uses, and weekly.
- [x] `pnpm dev`, the quality gate and the end-to-end tests are unchanged.

## Notes

The database roles (item B), the schema check at start-up (item C) and the operations
guide (item H) are later items of WT-12.
