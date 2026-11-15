# WI-041 — Security headers and Content Security Policy

- Status: Done
- Work-track: [WT-03](../work-tracks/WT-03-board-core.md) (found in the audit of 2026-11-13)
- Depends on: none. Must be done before WI-038, which first shows text written by users.
- Work-spec: [WS-041](../work-specs/WS-041-security-headers.md)

## Outcome

Opanel sends the standard browser security headers on every response, and a Content
Security Policy on every page. Today it sends none. From WI-038 on, the app renders
Markdown that any Member can write; the policy is the second line of defence if the
Markdown renderer or its configuration ever lets a script through.

## Acceptance criteria

- [x] Every response, pages and API alike, has `X-Content-Type-Options: nosniff` and
      `Referrer-Policy: strict-origin-when-cross-origin`.
- [x] Every page response has a `Content-Security-Policy` that allows scripts only from the
      app itself with a per-request nonce, forbids plugins, restricts `base-uri` and
      `form-action` to the app, and forbids being framed by any site.
- [x] Every page response also has `X-Frame-Options: DENY`, for browsers that predate
      `frame-ancestors`.
- [x] The nonce is different on every request and is not predictable.
- [x] With the policy on, every existing page works in the production build: sign-in,
      setup, accept link, the app shell, People, Profile, and the theme switch without a
      flash of the wrong theme. The browser reports no policy violation on any of them.
- [x] A script injected into a page without the nonce does not run (shown by a test).
- [x] `pnpm dev` still works: the development policy allows what the development tooling
      needs and nothing more.
- [x] The full quality gate passes.

## Notes

`Strict-Transport-Security` is deliberately not in this item: it must only be sent when
the site is really served over https, which is the reverse proxy's knowledge. It belongs
to the deployment work-track that is still to be decided (`docs/README.md`, Follow-ups).
