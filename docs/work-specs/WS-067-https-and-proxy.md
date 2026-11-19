# WS-067 — HSTS on `https:` installs, and the reverse proxy, tested

- Status: Done (approved by the owner on 2026-11-18, questions 1 to 5 as proposed)
- Work-item: [WI-067](../work-items/WI-067-https-and-proxy.md)
- Canonical docs: [0006](../canonical/0006-operations.md) (section 4: reverse proxy and
  HTTPS); [0002](../canonical/0002-realtime-sync.md) (the stream, unbuffered);
  [WS-041](WS-041-security-headers.md) (security headers), [WS-044](WS-044-request-body-limit.md)
  (512 KiB), [WS-022](WS-022-sign-in-hardening.md) (`CLIENT_IP_HEADER`, the limiter),
  [WS-062](WS-062-production-image.md) (the example install, the smoke test)

## Approach

### 1. Where things stand (checked on 2026-11-18, Next.js 16.4.6)

- Pages get their security headers in `src/proxy.ts`, which runs on the Node.js runtime
  (installed docs, `file-conventions/proxy.md`, "Runtime"); its matcher excludes `/api/`
  and static assets. API responses get theirs in `route()` (`src/server/http/route.ts`:
  `Cache-Control`, `X-Request-Id`). `next.config.ts` `headers()` adds two fixed headers.
- `headers()` in `next.config.ts` is read at build time, and the image is built without
  the environment (WS-062), so a header that depends on `APP_URL` cannot live there.
- The body limit is 512 KiB in `route()` (WS-044); the stream sends
  `X-Accel-Buffering: no` (WS-047); `clientIpFrom` takes the last entry of
  `CLIENT_IP_HEADER` (WS-022). The sign-in limiter allows 50 attempts per address per 15
  minutes (`SIGN_IN_IP_RULE`).

### 2. The header

`strictTransportSecurity(appUrl)` in `src/lib/security-headers.ts`, pure:
`"max-age=31536000"` when `appUrl` is `https:`, else `null`. No `includeSubDomains`, no
`preload`: whether other names under the domain serve HTTPS is the operator's knowledge,
and preloading is their decision (open question 1).

It is set, from `getEnv().APP_URL`, read at run time:

- by `src/proxy.ts`, on every page response it returns (next, redirect);
- by `route()`, on every API response, problem responses and the events stream included.

Static assets under `/_next/static` do not get it; a browser takes the policy from the
first page or API response, which always has it.

### 3. The example proxy

`docker/production/Caddyfile`, a complete example (doc 0006 section 4, question 2):

```caddy
{$OPANEL_SITE} {
	request_body {
		max_size 1MB
	}
	reverse_proxy app:3000 {
		header_up X-Forwarded-For {remote_host}
		flush_interval -1
	}
}
```

- `{$OPANEL_SITE}` is the public name (for example `opanel.example.com`); Caddy obtains a
  certificate and redirects HTTP to HTTPS by itself.
- `header_up X-Forwarded-For {remote_host}` replaces anything the client sent with the
  address Caddy saw, so `CLIENT_IP_HEADER=x-forwarded-for` can be trusted.
- `flush_interval -1` passes the stream through as it is written.
- `max_size 1MB`: above the app's 512 KiB, so the app answers its own `413` for bodies
  between the two, and the proxy refuses anything larger before it reaches the app.

`compose.production.yaml` gains a `proxy` service with `profiles: ["proxy"]` (started only
with `--profile proxy`): `caddy:2-alpine` pinned by digest, ports `80` and `443` (from
`OPANEL_HTTP_PORT` and `OPANEL_HTTPS_PORT`, default 80 and 443), the Caddyfile mounted, a
volume for its certificates. Operators with their own proxy ignore it. The guide of item H
gives the equivalent nginx settings.

### 4. The proxy smoke test

`scripts/smoke-proxy.sh`, its own Compose project and env file, run in CI and locally:

- `OPANEL_SITE=localhost` with Caddy's `tls internal` (a test-only Caddyfile line, through
  an environment variable `OPANEL_TLS=internal`, empty in the example), ports 8080 and
  8443; `APP_URL=https://localhost:8443`, `CLIENT_IP_HEADER=x-forwarded-for`.
- Checks, with `curl --insecure` (the test CA is not trusted, which the test does not
  need):
  1. `http://localhost:8080/sign-in` redirects to `https://localhost:8443/sign-in`;
  2. `https://localhost:8443/sign-in` and `/api/v1/health` carry
     `Strict-Transport-Security: max-age=31536000`;
  3. setup with the token (a session cookie), a project; `curl --no-buffer` on its events
     stream: `: connected` within 2 seconds; a task created then arrives as a
     `task.created` frame within 2 seconds, the stream still open;
  4. a 700 KiB JSON body to `POST /api/v1/projects` answers `413` with
     `code: "payload_too_large"`; a 2 MiB body answers `413` without the app's problem
     body;
  5. 51 sign-in attempts with wrong passwords, unknown emails, each sending a different
     `X-Forwarded-For`: the 51st answers `429` (the address the proxy saw, not the claimed
     ones, is limited).
- `scripts/smoke-production.sh` (direct, `http:` install) gains: no
  `Strict-Transport-Security` header on `/sign-in` and `/api/v1/health`.
- `.github/workflows/image.yml` runs both scripts, one after the other.

### Considered and not chosen

- **`next.config.ts` `headers()`**: evaluated at build time, without `APP_URL`.
- **Decide HTTPS from the request** (`X-Forwarded-Proto`): a header the client can forge
  unless the proxy is trusted; `APP_URL` is the operator's statement of the public address.
- **Testing the proxy only by reading its configuration**: the requirements interact
  (buffering, limits, the client address); only traffic through it shows they hold.
- **nginx as the tested example**: Caddy gives HTTPS and the redirect without extra
  configuration, which keeps the example short; nginx settings go in the guide.

## Files

| Path                                                    | Change                                      |
| ------------------------------------------------------- | ------------------------------------------- |
| `src/lib/security-headers.ts` (+ test)                  | modify: `strictTransportSecurity`           |
| `src/proxy.ts` (+ test)                                 | modify: the header on page responses        |
| `src/server/http/route.ts` (+ test)                     | modify: the header on API responses         |
| `docker/production/Caddyfile`                           | create: section 3                           |
| `compose.production.yaml`, `.env.production.example`    | modify: the `proxy` profile, its variables  |
| `scripts/smoke-proxy.sh`, `scripts/smoke-production.sh` | create/modify: section 4                    |
| `.github/workflows/image.yml`                           | modify: run both                            |
| `README.md`                                             | modify: the proxy profile in one paragraph  |
| `docs/README.md`, WT-12, WI-067, WS-067                 | modify: statuses; the follow-up's HSTS part |

## Data model changes

None.

## API contract

None: a response header, not part of the documented contract.

## Test plan (written first, in this order)

| #   | Level | Test                                                                                                  | Covers criterion |
| --- | ----- | ----------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit  | `strictTransportSecurity`: `https:` gives the value; `http:` gives null                               | 1                |
| 2   | unit  | `proxy`: a page and a redirect carry it with an `https:` `APP_URL`, not with `http:`                  | 1                |
| 3   | unit  | `route()`: a success, a problem and a streamed response carry it with `https:`, not with `http:`      | 1                |
| 4   | smoke | `smoke-proxy.sh` before the Caddyfile exists: fails (red, recorded)                                   | 2–5              |
| 5   | smoke | `smoke-proxy.sh` after: checks 1 to 5 of section 4; `smoke-production.sh`: no HSTS on `http:`         | 2–6              |
| 6   | CI    | the image workflow runs both                                                                          | 7                |
| 7   | gate  | `typecheck`, `lint`, `format:check`, `test`, `test:e2e` (the E2E app is `http:`: no header, as today) | 7                |

## Risks and open questions

For the owner:

1. **`max-age=31536000` (one year), without `includeSubDomains` or `preload`** (section 2).
   An operator who sets an `https:` `APP_URL` has committed to HTTPS; the other two are
   theirs to add at the proxy. **Recommend: as proposed.**
2. **The header follows `APP_URL`**, not the request (section 2). **Recommend: as
   proposed.**
3. **A Caddy example and an optional `proxy` profile**, tested by a second smoke test in CI
   (section 3, 4). It adds a pinned `caddy` image to the example and to CI; Opanel itself
   does not depend on it. **Recommend: as proposed.**
4. **The proxy allows 1 MB**, so bodies between 512 KiB and 1 MB get the app's own `413`
   (section 3). **Recommend: as proposed.**
5. **The client-address check spends 51 sign-in attempts** in the smoke test (about a
   second of password hashing). **Recommend: as proposed.**

## Deviations from the approved spec

1. **The proxy's site comes from `OPANEL_SITE` in the shell or a `.env` file beside the
   Compose file, never from the app's env file.** Compose does not substitute variables
   from a service's `env_file`, and giving that file to the proxy would put the database
   passwords and the session secret into the one container that faces the internet.
2. **The test-only TLS line is `{$OPANEL_CADDY_TLS}`** inside the site block (empty in the
   example, `tls internal` in the smoke test), and the smoke test's site is
   `https://localhost:8443`, so Caddy's redirect from HTTP keeps the port. The HTTPS port
   is mapped to the same port inside the container (`OPANEL_HTTPS_PORT`).
3. **The unit tests load `.env.test`** in `vitest.setup.ts`, as the integration tests do:
   every API response now reads `APP_URL`, and the route handlers' unit tests (health,
   OpenAPI, unknown paths, `route()`) had no environment. Nothing in them connects to the
   database it names.
4. **The proxy keeps `proxy()` as its entry point** and exports `handleProxy(request,
appUrl)` for the tests; `route()` passes its `appUrl` option to the shared wrapper,
   `unknownPathRoute()` too.
5. **`docker/**` triggers the image workflow**, so a change to the Caddyfile or the init
   script runs both smoke tests.

## Implementation record

- Red:
  - the unit tests of `strictTransportSecurity`, the proxy and `route()` failed before the
    code existed;
  - `scripts/smoke-proxy.sh` failed before the proxy existed (`https://localhost:8443`
    answered nothing).
- Green:
  - `strictTransportSecurity`; the header in `handleProxy` and in `route()`;
  - `docker/production/Caddyfile` and the `proxy` profile on
    `caddy:2-alpine@sha256:003a9780…` (Caddy 2.11.9);
  - the no-HSTS check of the direct smoke test; both scripts in `image.yml`;
  - README and `.env.production.example`.
- `scripts/smoke-proxy.sh` passed every check locally:
  - HTTP redirects to HTTPS on the same port;
  - HSTS on a page and on the API;
  - `: connected` and a `task.created` frame each within 2 s;
  - 700 KiB answered by the app with `payload_too_large`, 2 MiB refused by Caddy;
  - the 51st sign-in from one client, claiming 51 different addresses, answered `429`.
- `scripts/smoke-production.sh`: every earlier check, plus no HSTS on the `http:` install.
- `pnpm openapi:generate`: no change.
- Gate on 2026-11-18:
  - typecheck, lint and Prettier pass;
  - Vitest 1303 of 1303;
  - `pnpm test:e2e` 79 of 79 with `--retries=0`;
  - Windows, Node 24, pnpm 10.28.0, Compose PostgreSQL on port 5433.
