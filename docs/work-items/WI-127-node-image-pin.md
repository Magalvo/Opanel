# WI-127 — The Node.js base image pin is current

- Status: Proposed
- Work-track: none: the follow-up "The Node.js base image pin of the `Dockerfile` is stale"
  (found in WI-126, recorded on `main` in `923dee6`)
- Depends on: WI-126 (the weekly pin check and `CONTRIBUTING.md`, "Image pins")
- Work-spec: [WS-127](../work-specs/WS-127-node-image-pin.md)

## Outcome

The production image is built on the Node.js 22 image that `node:22-bookworm-slim` names
today, with its Debian and Node.js patch and security releases, and the weekly
`Dependency audit` workflow passes again.

Today the `Dockerfile` pins `node:22-bookworm-slim@sha256:e9f565d3…` (WS-062), while the
tag resolves to `sha256:be979e55…` (`scripts/check-image-pins.ts`, run by hand on
2026-11-25). The scheduled audit therefore fails every Monday until the pin moves. This
item moves it as `CONTRIBUTING.md` "Image pins" says: resolve the new digest, put it in a
pull request with the comment updated, and let that pull request's `Production image`
workflow rehearse it. The Node.js major version (22, of `.nvmrc`) does not change.

## Acceptance criteria

- [ ] `ARG NODE_IMAGE` in the `Dockerfile` is `node:22-bookworm-slim@sha256:<digest>`, the
      multi-platform index digest the tag resolves to on the day of implementation.
- [ ] The comment above it names the Node.js version the digest is (from the image's
      configuration), the date it was resolved, WS-127, and how to update it
      (`CONTRIBUTING.md`, "Image pins").
- [ ] `pnpm exec tsx scripts/check-image-pins.ts` reports every pin current (exit 0), where
      before the change it named the Node.js pin as stale (exit 1).
- [ ] A test fails if the major version of the `Dockerfile`'s Node.js tag differs from
      `.nvmrc` (WS-127, question 2).
- [ ] The pull request's `Production image` workflow passes on the new digest: build,
      install and migrations, the proxy, and a backup restored into a new install.
- [ ] The quality gate passes.

## Notes

- Decisions for the owner are in WS-127, "Risks and open questions".
- Resolving the digest reads the registry (manifests only). No image is pulled or built
  on the owner's machine without asking first.
- Out of scope: Node.js 24 (its own follow-up) and B10 (`engines.node`).
