# WS-043 — First-run setup refuses before hashing

- Status: Approved (approved by the owner on 2026-11-16, questions 1 to 5 as proposed)
- Work-item: [WI-043](../work-items/WI-043-setup-refuses-before-hashing.md)
- Canonical docs: [0004](../canonical/0004-api-conventions.md);
  [WS-016](WS-016-first-run-setup.md) (first-run setup); audit of 2026-11-14, finding A-01

## Approach

`createFirstAdmin` (`src/server/services/setup.ts`) hashes the password first, because the
hash is slow and must not run while the advisory lock is held (WS-016). Only then does it
take the lock and check `isSetupNeeded`. So on an installed server every well-formed
request pays for an Argon2id hash before it learns the answer is `404`, and nothing limits
how many may arrive: the endpoint is public and has no limiter.

The fix adds a cheap first look and keeps everything else:

1. `isSetupNeeded(db)` first. If any account exists, throw `notFound()` at once: nothing is
   hashed.
2. Hash the password, outside the lock, as today.
3. Open the transaction, take the advisory lock and check `isSetupNeeded(tx)` again, as
   today. **This second check is the one that decides**, so requests racing on an empty
   install still produce exactly one Admin. The first look only saves the hash on an
   installed server; it does not close the race and is not meant to.

The refusal is the same `404` as before, so it reveals nothing new: an installed server
already answers `404` to setup. The signature of `createFirstAdmin` does not change.

### How the tests see the hash (question 1)

The tests observe `hashPassword` with a spy, through `vi.mock` of `@/server/auth/password`
that calls the real function. This needs no new parameter, and it makes the tests fail
before the change: today the spy is called once even when an account exists. (The earlier
version of this item injected the hasher as a parameter; its "does not hash" tests passed
before the change, because the old code ignored that parameter.)

### Out of scope

An empty install: while it is empty every request legitimately hashes, so the first look
cannot help. The optional `SETUP_TOKEN` and a limiter are the tools for that, and they stay
a follow-up (question 2). WS-016 stays correct as a record; its implementation record gets
one line pointing here.

## Files

| Path                                            | Change                                        |
| ----------------------------------------------- | --------------------------------------------- |
| `src/server/services/setup.ts`                  | modify: the first look                        |
| `src/server/services/setup.integration.test.ts` | modify: new cases with the spy (tests first)  |
| `docs/work-specs/WS-016-first-run-setup.md`     | modify: one line in the implementation record |
| `docs/README.md`, WI-043, WS-043                | modify: statuses                              |

No new dependency, no migration.

## Data model changes

None.

## API contract

None. `POST /api/v1/setup` keeps its body and status codes.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                        | Covers criterion     |
| --- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| 1   | integration | with an active human account present: `404`, `hashPassword` was not called, nothing was created                                                             | no hash              |
| 2   | integration | the same with only a deactivated account, and with only an agent account                                                                                    | no hash              |
| 3   | integration | on an empty install `hashPassword` is called once, and the Admin, credential and audit entries are as in WS-016 (the existing tests kept)                   | still works          |
| 4   | integration | five concurrent requests on an empty install: exactly one account, the others `404` (existing test kept)                                                    | one Admin            |
| 5   | integration | an account is created while the hash runs (the spy inserts one, then hashes): the request is `404`, and no second account, credential or audit entry exists | second check decides |
| 6   | integration | route: a second `POST /api/v1/setup` is `404` with the unknown-path problem body (existing test kept)                                                       | no contract change   |
| 7   | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; `pnpm db:generate` and `pnpm openapi:generate` leave no diff                                       | gate                 |

## Risks and open questions

For the owner:

1. **A spy on `hashPassword` instead of a new parameter** (section "How the tests see the
   hash"), so the tests fail before the change and the service's signature stays the same.
   **Recommend: the spy.**
2. **The empty install stays exposed.** Until the first Admin is created, anyone who reaches
   the server can claim it, and every request hashes. The optional `SETUP_TOKEN` (WS-016
   question 1, in the follow-ups) is the real fix and is needed before any install is
   reachable from the internet. **Recommend: schedule it as its own item before the first
   usable release (end of WT-04), not in this one.**
3. **One more query** on the setup path: one `select … limit 1` on `accounts`, negligible
   next to a hash. **Recommend: accept.**
4. **This branch is stacked on WI-042** (`claude/wi-042-safe-error-logging-v2`), which is
   stacked on WI-044 (PR #37), only because each item updates the status lines of
   `docs/README.md`. Its pull request is opened once the ones below it are merged.
   **Recommend: as proposed.**
5. **The older branch** `claude/wi-043-setup-refuses-before-hashing` (2026-11-15) is replaced
   by this one. **Recommend: the branch can be deleted.**
