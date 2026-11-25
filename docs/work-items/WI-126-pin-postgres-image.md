# WI-126 — The production database image is pinned by digest

- Status: Proposed
- Work-track: none: follow-up B09 (audit of 2026-11-19), confirmed again by the independent
  audit of 2026-11-24 and in the files of `main` (`3c2a01a`)
- Depends on: none
- Work-spec: [WS-126](../work-specs/WS-126-pin-postgres-image.md)

## Outcome

Two installs of the same repository revision run the same PostgreSQL image, whenever they
were installed, and an operator has a written routine for moving to a newer one on purpose.

Today `docker/production/services.yaml` names `postgres:18-alpine`, a tag Docker Hub moves
with every PostgreSQL patch release and Alpine rebuild, while the app's Node.js base image
(WS-062) and Caddy (WS-067) are pinned by digest. A database that behaves differently
cannot be traced to a revision, and a rollback does not bring the old image back.

After this item the example install's database image is `postgres:18-alpine@sha256:…`, a
digest that the image workflow has rehearsed (install, proxy, backup and restore).
`docs/operations.md` says how to update it: resolve a new digest, rehearse it, back up,
switch; and why a patch update within PostgreSQL 18 is an image swap while a new major
version needs a dump and a restore into a new volume. So that the pin does not freeze
security updates, a weekly check fails when a pinned tag has moved on.

## Acceptance criteria

- [ ] Every image the example install pulls, and the base image of the `Dockerfile`, is
      named as `repository:tag@sha256:<64 hex digits>`; the check fails on a floating tag.
- [ ] The production database image is `postgres:18-alpine` pinned by a digest that the
      image workflow's three scripts (`smoke-production.sh`, `smoke-proxy.sh`,
      `rehearse-backup.sh`) passed on, and the smoke test checks that the running `db`
      container is that digest.
- [ ] `compose.yaml` (development and CI) keeps the same repository and tag as production,
      without a digest, and says why; a check fails if the two tags differ.
- [ ] The major version `docs/operations.md` gives for the database matches the pinned tag.
- [ ] `docs/operations.md` describes the pinned images and, in "Upgrade", how to move to a
      newer PostgreSQL image: resolving the digest, rehearsing backup, restore and
      migrations on it, applying it, going back, and why a new major version is a dump and
      restore, never a tag change on an existing volume.
- [ ] A weekly, non-blocking check names each pinned tag that now resolves to another
      digest, and `CONTRIBUTING.md` says what to do when it fails.

## Notes

- Decisions for the owner are in WS-126, "Risks and open questions".
- Resolving a digest reads the registry. No image is pulled or downloaded on the owner's
  machine without asking first.
