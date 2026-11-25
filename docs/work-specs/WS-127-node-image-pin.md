# WS-127 — The Node.js base image pin is current

- Status: Done (approved by the owner on 2026-11-25, with the recommended answers to
  its open questions; done on 2026-11-25)
- Work-item: [WI-127](../work-items/WI-127-node-image-pin.md)
- Canonical docs: [0006](../canonical/0006-operations.md) section 3 (every image pinned by
  digest, a weekly check); WS-062 (the image, its Node.js base pinned by digest), WS-126
  (`scripts/check-image-pins.ts`, `CONTRIBUTING.md` "Image pins")

## Approach

### 1. What is there today (`main`, `9f4bf69`)

```dockerfile
# Node.js of .nvmrc, pinned by digest. Update both together.
ARG NODE_IMAGE=node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee
```

`scripts/check-image-pins.ts`, run by hand on 2026-11-25 (WS-126, implementation record),
found PostgreSQL and Caddy current and this pin stale: the tag now resolves to
`sha256:be979e55…`. The audit workflow runs the script on schedule (Monday 06:17) and by
hand, so every scheduled run fails until the pin moves. `.nvmrc` is `22`.

### 2. The new pin

Following `CONTRIBUTING.md`, "Image pins":

1. **Red.** On the branch, before any change, run
   `pnpm exec tsx scripts/check-image-pins.ts`: it exits 1 and names
   `node:22-bookworm-slim` with the pinned and current digests. Recorded in the
   implementation record.
2. **Resolve the digest** with
   `docker buildx imagetools inspect node:22-bookworm-slim --format '{{json .Manifest}}'`:
   the OCI index (multi-platform) digest, so the pin works on amd64 and arm64 hosts, as the
   PostgreSQL and Caddy pins do. The Node.js version it is comes from the image
   configuration (`NODE_VERSION` of
   `docker buildx imagetools inspect node:22-bookworm-slim --format '{{json .Image}}'`).
   Both read manifests and configuration only; no layer is pulled (question 1). If the
   digest is not the `be979e55…` of the follow-up (the tag moved again), the newer one is
   taken and the record says so.
3. **Move the pin.** `ARG NODE_IMAGE` takes the new digest, and its comment takes the form
   of the PostgreSQL pin in `docker/production/services.yaml`:

   ```dockerfile
   # Node.js 22.x.y, the major version of .nvmrc, pinned by digest on 2026-11-DD (WS-127):
   # the same revision always builds on the same base. Update it with CONTRIBUTING.md,
   # "Image pins"; change the major version only together with .nvmrc.
   ARG NODE_IMAGE=node:22-bookworm-slim@sha256:<64 hex digits>
   ```

4. **Green.** `pnpm exec tsx scripts/check-image-pins.ts` exits 0, naming the three pins
   current.
5. **Rehearsal.** The `Dockerfile` is in the `Production image` workflow's `pull_request`
   paths, so the PR runs `smoke-production.sh`, `smoke-proxy.sh` and `rehearse-backup.sh`
   on an image built from the new base. That run is the rehearsal (`CONTRIBUTING.md`, step
   3). Before merging, the script is run once more: if the tag moved again meanwhile, the
   pin is moved again on the branch.

### 3. A guard: the `Dockerfile`'s Node.js major follows `.nvmrc`

`CONTRIBUTING.md` and the `Dockerfile`'s comment say the pin follows `.nvmrc`, and nothing
checks it: a digest update could take a `node:24-…` tag, or a future `.nvmrc` change could
leave the image on 22. `scripts/check-image-pins.test.ts` gains one repository check: the
tag of the `Dockerfile`'s `NODE_IMAGE` pin (read with the existing `imagePins`) starts with
the major version in `.nvmrc`, followed by `-` (`22-bookworm-slim` for `22`). It is a guard
and passes at once; it is seen red against a fixture (`.nvmrc` `24`, tag
`22-bookworm-slim`), as WS-126 saw its guide check red. Question 2 offers leaving it out.

No other code, doc or test changes: `docs/operations.md` names no Node.js digest, and
canonical doc 0006 already says the base image is pinned by digest and checked weekly.

## Files

| Path                                 | Change                                                |
| ------------------------------------ | ----------------------------------------------------- |
| `Dockerfile`                         | modify: `ARG NODE_IMAGE` digest and its comment       |
| `scripts/check-image-pins.test.ts`   | modify: the `.nvmrc` guard (section 3, if question 2) |
| `scripts/check-image-pins.ts`        | modify only if the guard needs a small pure helper    |
| `docs/work-items/WI-127-…`, `WS-127` | modify: statuses and the implementation record        |

## Data model changes

None.

## API contract

None.

## Test plan (written first, in this order)

| #   | Level  | Test                                                                                                                     | Covers criterion |
| --- | ------ | ------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| 1   | unit   | The `Dockerfile`'s Node.js tag starts with the major version of `.nvmrc`; red on a fixture with `.nvmrc` 24 and a 22 tag | 4                |
| 2   | script | `check-image-pins.ts` on the branch before the change: exit 1, the Node.js pin named stale (red)                         | 3                |
| 3   | script | `check-image-pins.ts` after the change: exit 0, the three pins current (green)                                           | 1, 3             |
| 4   | unit   | The existing `check-image-pins.test.ts` repository check still finds every pin as `repository:tag@sha256:<64 hex>`       | 1                |
| 5   | CI     | The PR's `Production image` workflow passes: build, install, migrations, proxy, backup restored into a new install       | 5                |
| 6   | gate   | `pnpm check`, `pnpm test`, `pnpm test:e2e`                                                                               | 6                |

Tests 2 and 3 read the registry (question 1). Test 5 is CI's run on the PR, recorded in the
implementation record. Criterion 2 (the comment) is checked by review of the diff.

## Risks and open questions

Questions for the owner (recommendations first):

1. **Registry access on this machine.** Resolving the digest and the Node.js version, and
   running `check-image-pins.ts` red and green, run `docker buildx imagetools inspect`
   against Docker Hub (manifests and configuration, no layers; about eight requests). The
   new image is not pulled or built locally: the PR's `Production image` workflow builds
   and rehearses it. **Recommend: allow the manifest reads, no local pull or build.**
   Otherwise the digest is taken from a `workflow_dispatch` run of the audit workflow on
   the branch, and tests 2 and 3 are seen only there.
2. **The `.nvmrc` guard** (section 3). It is one small test, not demanded by the
   follow-up, that stops the image and `.nvmrc` drifting apart (for example during the
   Node.js 24 upgrade). **Recommend: add it.** Alternative: digest only, the guard left out.

Risks:

- A new Node.js 22 patch or Debian rebuild could change behaviour of the built app. The
  image workflow runs the install, migrations, the proxy and a backup restore on it; the
  quality gate already runs on the latest Node.js 22 of `actions/setup-node` with `.nvmrc`,
  so the app has met recent 22 patches there.
- The tag can move again between resolving and merging; the check is run again before the
  merge (section 2, step 5), and otherwise next Monday's audit says so.

## Implementation record

- Red, guard (commit `2bfd407`): the three new tests of `check-image-pins.test.ts` failed
  with "`nvmrcMajor` is not a function"; the other 15 passed.
- Red, pin (plan test 2, 2026-11-25): `pnpm exec tsx scripts/check-image-pins.ts` exited 1:
  `node:22-bookworm-slim (Dockerfile, NODE_IMAGE) now resolves to sha256:be979e55…,
pinned sha256:e9f565d3…`.
- Digest (question 1, resolved on 2026-11-25 with `docker buildx imagetools inspect`):
  `node:22-bookworm-slim` is the OCI index
  `sha256:be979e5523c76fa4d5ca4ebd3099078f220aa47ec39c48ad5b5df9314debd6eb`, Node.js
  22.23.5 (`NODE_VERSION` of its image configuration), the digest the follow-up named. No
  image was pulled or built locally.
- Green: the pin and its comment in the `Dockerfile`, and `nvmrcMajor` in
  `scripts/check-image-pins.ts` (`22`, `v22.1.0` → 22, an alias such as `lts/*` → null).
  `check-image-pins.ts` then exited 0: "Pinned images are current: postgres:18-alpine,
  caddy:2-alpine, node:22-bookworm-slim." The guard's red fixture (plan test 1) is the
  assertion that tag `22-bookworm-slim` and `.nvmrc` `24` differ in major version.
- Gate on the branch: `pnpm check` passed; `pnpm test` 2413/2413; `pnpm test:e2e` 123/123.
- Plan test 5: on PR #131 the `Production image smoke test` job passed (3m45s; install,
  migrations, proxy, backup restored into a new install, on the new base), with every other
  check. `check-image-pins.ts` was run again before the merge: every pin current.
