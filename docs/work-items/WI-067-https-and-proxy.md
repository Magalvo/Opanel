# WI-067 — HSTS on `https:` installs, and the reverse proxy, tested

- Status: Done
- Work-track: [WT-12](../work-tracks/WT-12-operations.md) (item F)
- Depends on: WI-062 (the image, the example install, the smoke test)
- Work-spec: [WS-067](../work-specs/WS-067-https-and-proxy.md)

## Outcome

Opanel expects an HTTPS reverse proxy in front of it (doc 0006 section 4) but nothing
checks that the requirements hold together, and the app never sends
`Strict-Transport-Security`: WI-041 left it out because only the deployment knows whether
the site is really served over HTTPS (`docs/README.md`, Follow-ups).

After this item:

- every page and API response carries `Strict-Transport-Security: max-age=31536000` when
  `APP_URL` is an `https:` URL, and none when it is `http:` (development, tests, a plain
  local install);
- the repository holds a working example proxy, `docker/production/Caddyfile`, which an
  optional `proxy` profile of `compose.production.yaml` runs in front of the app;
- a second smoke test runs the example install behind that proxy and checks each
  requirement of doc 0006 section 4: HTTPS with a redirect from HTTP, the HSTS header, the
  events stream delivered without buffering, the body limits, and the client address taken
  from the proxy rather than from the client.

## Acceptance criteria

- [x] With an `https:` `APP_URL`, a page, an API response, a problem response and the
      events stream each carry `Strict-Transport-Security: max-age=31536000`; with an
      `http:` one, none does.
- [x] Behind the example proxy, `http://` redirects to `https://`.
- [x] Behind it, the events stream's first frame (`: connected`) arrives within 2 seconds
      and an event committed afterwards arrives without the stream closing.
- [x] Behind it, a JSON body of 700 KiB is answered by the app with `413
  payload_too_large`; one of 2 MiB is refused by the proxy itself.
- [x] Behind it, a client's own `X-Forwarded-For` is ignored: the sign-in limiter of the
      client's address answers `429` at the 51st attempt from one client whatever address
      it claims.
- [x] The direct smoke test (WS-062) checks that its `http:` install sends no HSTS header.
- [x] CI runs both smoke tests. No API contract change. The full quality gate passes.
- [x] The README follow-up's HSTS part is marked as answered.
