# WS-040 — Account link hardening

- Status: Proposed (must be `Approved` by the owner before any code is written)
- Work-item: [WI-040](../work-items/WI-040-account-link-hardening.md)
- Canonical docs: [0001](../canonical/0001-ai-qa-agents-and-triage.md) section 4; WT-02
  design decisions 5, 6 and 10; WS-019, WS-024

## Approach

All three changes are in services. No route handler, schema or contract changes.

### 1. Check the link before hashing the password

`acceptLink` (`src/server/services/accept-link.ts`) hashes the password first because the
hash is slow and should not run while a row lock is held. The fix keeps that property and
adds a cheap first look:

1. Read the link by token hash, with its account, **without a lock**. If it is unknown,
   used, expired, or its account is deactivated or not human, throw `invalidLink()` now.
   Nothing has been hashed.
2. Hash the password.
3. Open the transaction and run today's logic unchanged: take the account lock, lock the
   link row, and check everything again. The second check is the one that decides, so two
   requests racing on one link still produce exactly one success.

There is no timing concern in refusing early: the token is 256 random bits, so learning
quickly that a guess is wrong helps nobody guess.

The validity rules move into one function used by both the first look and the locked
check, so they cannot drift apart.

### 2. Lock the account when issuing a link

`issueResetLink` (`src/server/services/account-management.ts`) calls
`lockAccount(tx, accountId)` as the first statement of its transaction, before it reads the
account or touches `account_tokens`. This is the order `acceptLink` and `revokeInvitation`
already use (WS-024), so all three take the advisory lock before any row lock.

`inviteAccount` needs no change: it creates the account in the same transaction, so no
other transaction can hold anything of it.

### 3. Sign in without consuming the limiter when the caller has just proved the credential

`signIn` takes a third option, `trusted: true`, used only by `acceptLink` and
`createFirstAdmin`. With it, `signIn` does not consume the per-email and per-address
counters and is not refused by them. Everything else is the same: Better Auth still
verifies the password, the session is created, `last_seen_at` is set and `auth.sign_in` is
audited.

It is safe because both callers reach that line only after setting the password themselves
in a committed transaction, from input that already passed its own check (a valid one-time
token, or an empty install). It is not reachable from the sign-in endpoint: the route calls
`signIn` without options, and a test asserts that.

The counters are left as they are, neither consumed nor reset, so someone hammering that
email with wrong passwords stays blocked.

## Files

| Path                                                         | Change                                       |
| ------------------------------------------------------------ | -------------------------------------------- |
| `src/server/services/accept-link.ts`                         | modify: first look before hashing; `trusted` |
| `src/server/services/accept-link.integration.test.ts`        | modify (new cases written first)             |
| `src/server/services/account-management.ts`                  | modify: `lockAccount` in `issueResetLink`    |
| `src/server/services/account-management.integration.test.ts` | modify (new case written first)              |
| `src/server/services/sign-in.ts`                             | modify: `trusted` option                     |
| `src/server/services/sign-in.integration.test.ts`            | modify (new cases written first)             |
| `src/server/services/setup.ts`                               | modify: pass `trusted`                       |
| `src/server/services/setup.integration.test.ts`              | modify (new case written first)              |
| `docs/README.md`                                             | modify: remove the closed follow-up          |

No new dependencies.

## Data model changes

None.

## API contract

None. `POST /api/v1/account-links/accept` and `POST /api/v1/setup` keep their bodies and
status codes. The one visible difference: a person with a valid link is no longer answered
`429` because of earlier failed sign-ins for their email.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                             | Covers criterion           |
| --- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| 1   | integration | `acceptLink` with an unknown token: `404`, and the injected password hasher was not called                                                                       | no hash when refused       |
| 2   | integration | the same for a used link, an expired link, a replaced link and the link of a deactivated account                                                                 | no hash when refused       |
| 3   | integration | a valid link: the hasher is called once, the password works, the link is used                                                                                    | still works                |
| 4   | integration | ten concurrent accepts of one valid link: exactly one succeeds, nine get `404` (existing test, kept)                                                             | single use                 |
| 5   | integration | a link that is valid at the first look and revoked before the transaction: `404`, nothing written (the locked check decides)                                     | single use                 |
| 6   | integration | `issueResetLink` and `acceptLink` for the same account, run together 20 times: all finish within the test timeout, and afterwards at most one unused link exists | no deadlock                |
| 7   | integration | with the email's sign-in counter over its limit, accepting a valid link returns the account and a session cookie                                                 | signed in despite limiter  |
| 8   | integration | right after that, an ordinary `signIn` for the same email is still refused with `429`                                                                            | limiter not bypassed       |
| 9   | integration | first-run setup with the email's counter over its limit still returns a session                                                                                  | setup                      |
| 10  | integration | the sign-in route calls `signIn` without `trusted`: 11 wrong attempts through the route are refused as before                                                    | not reachable from outside |
| 11  | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`                                                                                                          | gate                       |

The hasher is injected as an optional argument of `acceptLink`, defaulting to
`hashPassword`, the way `signIn` takes its audit rule. The database is not mocked.

## Risks and open questions

1. **An early refusal is a second read of the link.** One indexed lookup; negligible next
   to the hash it saves.
2. **`trusted` is a sharp option.** It is internal to the service layer and documented at
   its definition; test 10 guards the public path. **Owner: acceptable, or would you rather
   the person be told to sign in manually after the limiter window?**
