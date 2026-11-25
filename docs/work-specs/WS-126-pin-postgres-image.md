# WS-126 — The production database image is pinned by digest

- Status: Proposed
- Work-item: [WI-126](../work-items/WI-126-pin-postgres-image.md)
- Canonical docs: [0006](../canonical/0006-operations.md) (packaging, upgrades, backup);
  WS-062 (the image, its Node.js base pinned by digest, question 3), WS-067 (Caddy pinned
  by digest), WS-068 (the backup rehearsal), WS-053 and WS-061 (the weekly audit workflow
  and a check that fails once something it tracks has moved)

## Approach

### 1. What is there today (`main`, `3c2a01a`)

| Where                                    | Image                                             |
| ---------------------------------------- | ------------------------------------------------- |
| `Dockerfile`, `ARG NODE_IMAGE`           | `node:22-bookworm-slim@sha256:e9f565d3…` (WS-062) |
| `docker/production/services.yaml`, proxy | `caddy:2-alpine@sha256:003a9780…` (WS-067)        |
| `docker/production/services.yaml`, db    | `postgres:18-alpine`, floating                    |
| `compose.yaml` (development and CI), db  | `postgres:18-alpine`, floating                    |

No test reads these lines: nothing would notice a pin being dropped. The image workflow
(`.github/workflows/image.yml`, weekly and on changes to `docker/**` or `scripts/**`) runs
`smoke-production.sh`, `smoke-proxy.sh` and `rehearse-backup.sh` against
`compose.production.yaml`, so whatever `services.yaml` names is what CI rehearses.

### 2. The pin

`services.yaml`'s `db` becomes `image: postgres:18-alpine@sha256:<digest>`, the form Caddy
uses, with a comment: the PostgreSQL version it is (for example 18.x), the date it was
resolved, and "update with docs/operations.md, Upgrade". The digest is the **index**
(multi-platform) digest that `postgres:18-alpine` resolves to on the day of implementation,
so the pin works on amd64 and arm64 hosts alike:

```bash
docker buildx imagetools inspect postgres:18-alpine --format '{{json .Manifest}}'
```

That reads the manifest from Docker Hub; it pulls no layer. It is run only with the
owner's go-ahead (question 3). The PR's image workflow then rehearses the pinned digest:
install, migrate, proxy, backup and restore. That run is what "tested digest" means here.

### 3. `compose.yaml` stays floating, on purpose

`compose.yaml` keeps `postgres:18-alpine` without a digest, with a comment saying why:

- Development and CI then meet each new PostgreSQL 18 patch release first: the quality
  gate (integration and end-to-end tests on a real database) runs on it before anyone moves
  production's pin. CI already prints `postgres --version`.
- What production runs is still tested exactly: the image workflow uses the pinned file.
- A digest in `compose.yaml` would need the same update routine twice, and a stale one
  would hide the next patch release from the tests.

What must not drift is the major version and the variant: a test fails if the two files'
`repository:tag` differ (section 5). Question 1 offers pinning it too.

### 4. A weekly check that the pins are current: `scripts/check-image-pins.ts`

A pin freezes security updates as well. As `check-ignored-advisories.ts` does for ignored
advisories (WS-061), a script fails once a pinned tag has moved on:

- `imagePins(files)` (pure): from `docker/production/services.yaml` (`image:` lines) and
  the `Dockerfile` (`ARG …_IMAGE=` lines), every reference with its repository, tag and
  digest (`null` when floating). `opanel-app:local` is built, not pulled, and is skipped
  (its service has `build:`).
- `stalePins(pins, resolved)` (pure): each pin whose tag now resolves to another digest,
  with both digests.
- `main()`: runs the `imagetools inspect` command above for each pin's `repository:tag`, validates the output with Zod (`{ digest }`), and
  prints for each stale pin: the tag, the pinned digest, the current one, and "see
  CONTRIBUTING.md, Image pins". Exit code 1 if any is stale, 0 otherwise, naming the pins
  it checked.

It runs as a new step of `.github/workflows/audit.yml` (weekly, Monday 06:17, and by hand),
only on `schedule` and `workflow_dispatch`: a PostgreSQL release must not fail an unrelated
pull request that changes `package.json`. A failed scheduled run is the reminder GitHub
mails to the owner. The check covers all three pins, not only PostgreSQL (question 2): Node
and Caddy have the same frozen-security-update problem, and the script is the same.

`CONTRIBUTING.md` gains "Image pins", next to "Dependency advisories": what the failure
means, how to resolve the new digest, that the PR's image workflow is the rehearsal, that
the comment's version and date are updated, and that the Node.js pin follows `.nvmrc`
(WS-062). A PostgreSQL major version is never changed this way (section 6).

### 5. Checks in the quality gate: `scripts/check-image-pins.test.ts`

Pure tests of `imagePins` and `stalePins`, and checks of the repository's files:

- every pulled image of `services.yaml`, and the `Dockerfile`'s base, has
  `repository:tag@sha256:<64 hex>`;
- `compose.yaml`'s `db` has the same `repository:tag` as production's, without a digest;
- the line "`db`: PostgreSQL NN" of `docs/operations.md` names the major version of the
  pinned tag (`18-alpine` → 18).

No YAML parser is added (none is a dependency): the files are read line by line, as
`check-ignored-advisories.ts` reads `pnpm-workspace.yaml`, and a test fails if a service
has neither `image:` nor `build:`, so a layout the reader does not understand is noticed.

### 6. `docs/operations.md`

- **Before you start**: the `db` line names the image (`postgres:18-alpine`, pinned by
  digest in `docker/production/services.yaml`), and one paragraph says every image the
  example pulls is pinned by digest, so a revision always installs the same images; the
  Opanel repository moves the pins (a release or a commit on `main` brings new ones), and
  an operator may move the database's earlier, as in "Upgrade".
- **Upgrade** gains `### Updating PostgreSQL` (the `##` sections the guide test lists do
  not change):
  1. **Patch updates within 18** (18.x to 18.y, and Alpine rebuilds) keep the on-disk
     format: the new image runs on the existing volume. Read the PostgreSQL release notes
     first: some ask for a step after updating (for example a `REINDEX`).
  2. **Resolve the digest** with `docker buildx imagetools inspect` (above), and put it in
     `services.yaml` in place of the old one.
  3. **Rehearse it** on any machine with Docker before touching the install:
     `bash scripts/smoke-production.sh` (install and migrations) and
     `bash scripts/rehearse-backup.sh` (a backup restored into a new install, which needs
     Node.js too), the commands CI runs.
  4. **Apply it**: back up, then
     `docker compose -f compose.production.yaml up -d db` (recreates only the database,
     keeps the volume), check `pg_isready` and `postgres --version`, and the app's health.
  5. **Going back**: put the old digest back and `up -d db` again; within one major
     version the data directory is compatible both ways. If it is not healthy, restore the
     backup into a new install.
  6. **A new major version** (19) is not an image swap. The 18 image keeps its data in
     `/var/lib/postgresql/18/docker` of the volume; a 19 image would find no cluster of its
     own there and **create a new, empty one** next to it, and Opanel would start on an
     empty database. A major upgrade is a dump with the old image and a restore into a new
     volume with the new one ("Restoring into a new install"), and only once an Opanel
     version supports that major: CI and `compose.yaml` move first. `pg_upgrade` is not
     rehearsed and not described.
- The guide's introduction says two procedures are not rehearsed by CI. Swapping the image
  of a running install (steps 4 and 5) is a third: CI installs each pin new, it never
  replaces one under an existing volume. The new section says so where it appears, and the
  introduction's count becomes three. The major upgrade is the restore CI rehearses.
  `guideProblems` must still find nothing (new files and commands named exist).

### 7. The smoke test

`scripts/smoke-production.sh`, after the install is healthy: the image the `db` container
runs (`docker inspect` of its image's `RepoDigests`) contains the digest of
`services.yaml`, and the log prints `postgres --version`, so each image workflow run
records which PostgreSQL it rehearsed.

### 8. Canonical doc 0006

Section 3 gains: every image the example install pulls, and the `Dockerfile`'s base, is
pinned by digest; a weekly check fails when a pinned tag moves; development and CI follow
the database's tag, floating, so a patch release meets the tests first. Section 6 gains:
a PostgreSQL patch update is an image swap on the same volume; a major upgrade is a dump
and a restore into a new volume.

## Files

| Path                                 | Change                                               |
| ------------------------------------ | ---------------------------------------------------- |
| `docker/production/services.yaml`    | modify: `db` pinned by digest, with its comment      |
| `compose.yaml`                       | modify: a comment on why the tag floats              |
| `scripts/check-image-pins.ts`        | create: `imagePins`, `stalePins`, the registry check |
| `scripts/check-image-pins.test.ts`   | create: section 5                                    |
| `scripts/smoke-production.sh`        | modify: section 7                                    |
| `.github/workflows/audit.yml`        | modify: the weekly pin check (section 4)             |
| `docs/operations.md`                 | modify: section 6                                    |
| `CONTRIBUTING.md`                    | modify: "Image pins"                                 |
| `docs/canonical/0006-operations.md`  | modify: section 8                                    |
| `docs/work-items/WI-126-…`, `WS-126` | modify: statuses and the implementation record       |

## Data model changes

None.

## API contract

None.

## Test plan (written first, in this order)

| #   | Level | Test                                                                                                                                          | Covers criterion |
| --- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit  | `imagePins` reads `image:` and `ARG …_IMAGE=` lines into repository, tag and digest; a floating tag has no digest; a built service is skipped | 1                |
| 2   | unit  | `imagePins` refuses a service with neither `image:` nor `build:`                                                                              | 1                |
| 3   | unit  | Every pulled image of `services.yaml` and the `Dockerfile`'s base carries `tag@sha256:<64 hex>` (red today on `db`)                           | 1, 2             |
| 4   | unit  | `compose.yaml`'s `db` has production's `repository:tag`, without a digest                                                                     | 3                |
| 5   | unit  | The guide's "`db`: PostgreSQL NN" matches the pinned tag's major version (red with an 18 guide and a 17 tag in a fixture)                     | 4                |
| 6   | unit  | `stalePins` names a pin whose tag resolves to another digest, with both; nothing when all match                                               | 6                |
| 7   | unit  | The output of `imagetools inspect --format '{{json .Manifest}}'` is parsed to its digest, and anything else is refused (Zod)                  | 6                |
| 8   | unit  | The guide test (`operations-guide.test.ts`) still passes with the new section: same `##` sections, no unknown command, variable or file       | 5                |
| 9   | smoke | `smoke-production.sh`: the `db` container runs the pinned digest (red before the pin: a floating tag has no digest to match)                  | 2                |
| 10  | CI    | The PR's image workflow passes on the pin: install, proxy, backup and restore                                                                 | 2                |

Test 9 needs Docker and the image (question 3). Test 10 is CI's run on the PR, recorded in
the implementation record. The registry call of `main()` is not unit tested; it is run once
by hand (question 3) and by the workflow's `workflow_dispatch` on the branch.

## Risks and open questions

Questions for the owner (recommendations first):

1. **`compose.yaml` stays floating** (section 3), its tag kept equal to production's by a
   test. The alternative pins it too: CI is then fully reproducible, but each update is two
   edits and the tests stop meeting a new patch release before production does.
   **Recommend: floating, with the comment and the test.**
2. **The weekly pin check covers all three pins** (PostgreSQL, Caddy, Node.js) and runs in
   the audit workflow on schedule and by hand only (section 4). Alternatives: PostgreSQL
   only; or no automated check, only the routine in the docs. **Recommend: all three, as
   proposed.** A failing scheduled run on `main` is a reminder to act, not a broken build.
3. **Registry and image access on this machine.** Resolving the digest runs
   `docker buildx imagetools inspect postgres:18-alpine` (reads the manifest from Docker
   Hub, no layers). Running the smoke test locally (test 9 red and green) pulls the pinned
   `postgres:18-alpine` image (on the order of 100 MB), and rebuilds the app image. **Recommend:
   allow both; otherwise the digest is resolved by a `workflow_dispatch` run of the
   branch's audit workflow, and test 9 is seen red and green only in CI.**

Risks:

- Docker Hub rate limits: the weekly check makes three manifest requests a week, far below
  the anonymous limit.
- A tag can be re-pushed for an Alpine rebuild with the same PostgreSQL version; the check
  then fails although PostgreSQL did not change. That is intended: Alpine fixes are
  security updates too.
- Going back within 18 relies on PostgreSQL's promise that minor releases keep the data
  format; a release note may still require a step. The guide says to read the notes and
  keeps the backup as the way back.
