# WI-125 — Failed API token attempts are limited per address

- Status: Done (approved by the owner on 2026-11-25, with WS-125; done on 2026-11-25)
- Work-track: none: follow-up B07 (audit of 2026-11-19), confirmed again by the independent
  audit of 2026-11-24 and in the code of `main` (`0243e77`)
- Depends on: none
- Work-spec: [WS-125](../work-specs/WS-125-failed-token-limit.md)

## Outcome

A client that keeps sending API tokens that do not authenticate is slowed down by the app
itself, per client address, before each attempt reaches the database.

Today the per-token limit (600 a minute, WS-072) counts only after a token has
authenticated. A well-formed but wrong token (`opk_<public id>_<secret>`) costs an indexed
lookup of `api_tokens` every time and consumes no limit at all; WS-072 handed this to the
reverse proxy, but the example Caddyfile sets no limit. It is an availability concern, not a
way to guess a token: the secret is random. The audit asks for it to be fixed before any
install faces the internet.

After this item, when the operator has set `CLIENT_IP_HEADER` (the address their proxy
writes), each client address may fail token authentication a bounded number of times per
window; past that, its token requests answer `429 rate_limited` with `Retry-After` without
touching the database, until the window ends. Without a trusted address the app keeps
today's behaviour and says so in its start-up warning and in `docs/operations.md`.

## Acceptance criteria

- [x] With `CLIENT_IP_HEADER` set, once one address has failed token authentication the
      allowed number of times in a window, every further token request from it in that
      window answers `429 rate_limited` with a `Retry-After` of at most the window's
      remaining seconds, and makes no database query.
- [x] The refusal is stable: every request of a flood past the limit gets the same `429`,
      and a request after the window has ended is authenticated again.
- [x] A client cannot leave its count by changing what it sends: only the last entry of the
      configured header is read (as for sign-in), other forwarding headers are ignored,
      the IPv6 addresses of one `/64` count together, and an IPv4-mapped IPv6 address
      counts as its IPv4 address.
- [x] Requests with a valid token never add to the count, and a valid token from another
      address is unaffected while one address is refused.
- [x] Every `401` of a token request has the same body, whatever the reason (malformed,
      unknown, wrong secret, revoked, expired, disabled agent), before and after this
      change; the `429` body is the same as the per-token limit's.
- [x] Neither the limiter nor any log line holds any part of the `Authorization` header.
- [x] The limiter's memory is bounded: at most a fixed number of addresses are tracked, and
      ended windows are swept.
- [x] Without `CLIENT_IP_HEADER`, token requests behave as today, and the production
      start-up warning says that failed token attempts are then not limited per address.
- [x] Session (cookie) requests and the event stream's heartbeat checks are not counted.
- [x] `docs/operations.md`, `docs/agents.md` and canonical doc 0001 describe the new limit,
      which answers WS-072's question 3 (unauthenticated limiting left to the proxy).

## Notes

- B07 offered two directions: an app limiter keyed by the trusted client address, or a
  limit in the example proxy. Caddy has no rate limiter in its standard build (it needs a
  third-party module, so a custom image), so WS-125 recommends the app limiter, with the
  proxy limit as an open question.
- Cookie requests also cost a session lookup each; they are out of scope (B07 is about
  tokens) and listed in WS-125's open questions.
