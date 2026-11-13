# WS-041 — Security headers and Content Security Policy

- Status: Proposed (must be `Approved` by the owner before any code is written)
- Work-item: [WI-041](../work-items/WI-041-security-headers.md)
- Canonical docs: `AGENTS.md` section 2 and hard rule 13; WT-03 design decision 14

## Approach

Read first, for the installed Next.js 16.4.6:
`node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`. What follows is
taken from it; anything that turns out different in practice is a deviation to record.

### 1. Static headers for everything

`next.config.ts` gains an async `headers()` that adds to every path:

```
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
```

The `accept` page keeps its stricter `no-referrer` meta tag.

### 2. The policy, with a nonce, in the proxy

`src/proxy.ts` already runs on every page request to redirect visitors without a session
cookie. It gains the policy, following the guide: generate a nonce, put the policy on the
request (so Next.js can read the nonce and stamp its own scripts) and on the response.

```
default-src 'self';
script-src 'self' 'nonce-<nonce>' 'strict-dynamic';
style-src 'self' 'unsafe-inline';
img-src 'self' blob: data:;
font-src 'self';
connect-src 'self';
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'none';
```

plus `X-Frame-Options: DENY` on the same responses.

- The policy string is built by a pure function `contentSecurityPolicy({ nonce, development })`
  in `src/lib/security-headers.ts`, so it is unit-tested without a server.
- In development only, `script-src` also gets `'unsafe-eval'`, which the guide says React's
  development build needs. Production never has it.
- The nonce is 16 random bytes from `crypto.getRandomValues`, base64. (The guide's example
  derives it from a UUID; random bytes are the same idea with nothing to decode.)
- The proxy's redirect to `/sign-in` carries the same headers.
- API responses do not get the policy: they are JSON, never rendered as a page, and already
  have `no-store` and now `nosniff`. The proxy keeps skipping `/api/`.

`upgrade-insecure-requests` from the guide's example is left out: an install on plain http
inside a private network is a supported way to run Opanel, and that directive would break
it.

### 3. `style-src 'unsafe-inline'`, and why

The guide's example uses a nonce for styles too. That blocks every `style="..."`
attribute in server-rendered HTML, and the app has them: the sidebar sets CSS variables
that way, and the drag-and-drop library planned for the board (WT-03 decision 15) positions
cards with inline transforms. Allowing inline styles does not allow scripts; what it gives
up is protection against an attacker restyling the page, which needs an HTML injection
that `script-src` and the Markdown configuration already block. **This is the main
judgement call of the spec: see question 1.**

### 4. The theme script

`next-themes` injects a small inline script that sets the theme before the page paints.
`src/app/layout.tsx` reads the nonce from the `x-nonce` request header and passes it to
`ThemeProvider`, which passes it to `next-themes` (its `nonce` prop). Reading a request
header makes the root layout dynamic.

### 5. Every page becomes dynamically rendered

A nonce is per request, so no page can be prerendered at build time any more (the guide
states this). All of Opanel's pages already depend on the session or the database except
the static shell of `/accept`. The cost is that `/accept` is rendered per request. This is
checked in the `pnpm build` output and recorded.

## Files

| Path                                 | Change                                                  |
| ------------------------------------ | ------------------------------------------------------- |
| `src/lib/security-headers.ts`        | create: policy builder, nonce generator                 |
| `src/lib/security-headers.test.ts`   | create (written first)                                  |
| `src/proxy.ts`                       | modify: nonce, policy and `X-Frame-Options` on pages    |
| `src/proxy.test.ts`                  | modify (new cases written first)                        |
| `next.config.ts`                     | modify: `headers()` for the two static headers          |
| `src/app/layout.tsx`                 | modify: read the nonce, pass it to the theme provider   |
| `src/components/theme-provider.tsx`  | modify: `nonce` prop                                    |
| `tests/e2e/security-headers.spec.ts` | create (written first)                                  |
| `tests/e2e/fixtures.ts`              | modify: fail a test on any CSP violation in the console |
| `CONTRIBUTING.md`                    | modify: a short "Content Security Policy" note          |

No new dependencies.

## Data model changes

None.

## API contract

None. API responses gain two headers; bodies and status codes are unchanged.

## Test plan (written first, in this order)

| #   | Level        | Test                                                                                                                                         | Covers criterion        |
| --- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 1   | unit         | the policy contains each directive above with the given nonce; no `unsafe-eval` and no `unsafe-inline` in `script-src` for production        | policy                  |
| 2   | unit         | the development policy adds `'unsafe-eval'` to `script-src` and nothing else                                                                 | development             |
| 3   | unit         | 1 000 generated nonces are all different, base64, and at least 22 characters                                                                 | nonce                   |
| 4   | unit         | proxy: a page request gets the policy and `X-Frame-Options: DENY` on the response and the policy and `x-nonce` on the forwarded request      | pages have the policy   |
| 5   | unit         | proxy: the redirect to `/sign-in` has them too; two requests get different nonces; `/api/` requests are passed through untouched             | pages have the policy   |
| 6   | e2e          | `GET /`, `/sign-in`, `/accept` and `/api/v1/health` have `nosniff` and the referrer policy; the three pages have the policy, the API has not | every response          |
| 7   | e2e          | the nonce in the header equals the `nonce` attribute of the scripts in the page, and differs between two loads                               | nonce                   |
| 8   | e2e          | a script element added to the page without the nonce does not run, and the browser reports a policy violation                                | injected script blocked |
| 9   | e2e          | all existing end-to-end tests pass with a fixture that fails any test on a CSP violation message in the console                              | existing pages work     |
| 10  | e2e          | with a dark system setting, the first paint of `/sign-in` is dark (the existing theme tests, kept)                                           | theme script            |
| 11  | manual, once | `pnpm dev`: sign in, open People and Profile, switch the theme; the browser console shows no violation                                       | development             |
| 12  | gate         | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; `pnpm build` output recorded                                                        | gate                    |

## Risks and open questions

1. **`style-src 'unsafe-inline'`.** Explained in section 3. The stricter alternative is a
   nonce for styles and removing every inline style attribute, including the library
   planned for drag and drop. I recommend accepting inline styles. **Owner: agree?**
2. **Report-only first?** A policy can be sent as `Content-Security-Policy-Report-Only`,
   which reports violations and blocks nothing. With few pages and test 9 covering all of
   them, I propose to enforce from the start. **Owner: agree?**
3. **Future UI work must keep to the policy:** no inline event handlers, no scripts from
   other origins, no `eval`. Test 9's fixture makes a violation fail the end-to-end suite,
   so it is caught in the item that introduces it.
4. **If the nonce cannot reach `next-themes`** in the installed versions, the theme script
   is blocked and the page flashes the wrong theme. I would then stop and report, with the
   option of setting the theme class on the server from a cookie instead.
