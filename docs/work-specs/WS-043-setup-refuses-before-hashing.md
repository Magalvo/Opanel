# WS-043 — First-run setup refuses before hashing

- Status: Approved
- Work-item: [WI-043](../work-items/WI-043-setup-refuses-before-hashing.md)
- Canonical docs: [0004](../canonical/0004-api-conventions.md); WS-016; audit of 2026-11-14,
  finding A-01

## Approach

`createFirstAdmin` (`src/server/services/setup.ts`) computes the Argon2 hash first, because
it is slow and must not run while the advisory lock is held (WS-016). It then takes the lock
and checks `isSetupNeeded`. On an installed server every well-formed request therefore pays
for a hash before it learns the answer is `404`, and nothing limits how many may arrive.

The fix adds a cheap first look and keeps everything else:

1. Call `isSetupNeeded(db)` first. If any account exists, throw `notFound()` now. Nothing is
   hashed.
2. Hash the password.
3. Open the transaction, take the advisory lock and check `isSetupNeeded(tx)` again, as
   today. **That second check is the one that decides**, so two requests racing on an empty
   install still produce exactly one Admin. The first look is only an optimisation; it does
   not close the race and is not meant to.

The refusal is the same `404` as before, so it reveals nothing new: it was already
public that an installed server answers `404` to setup.

The hasher becomes an optional third argument, `hash = hashPassword`, so tests can count
calls without mocking the database. This is the same pattern WS-040 uses for `acceptLink`.

Out of scope: protecting an install that is still empty. While it is empty every request
legitimately hashes, so the cheap check cannot help; `SETUP_TOKEN` and a limiter are the
tools for that and remain the follow-up recorded in `docs/README.md`.

WS-016 stays correct as a record. Its implementation record gets one line pointing here.

## Files

| Path                                            | Change                                        |
| ----------------------------------------------- | --------------------------------------------- |
| `src/server/services/setup.ts`                  | modify: first look; injectable hasher         |
| `src/server/services/setup.integration.test.ts` | modify (new cases written first)              |
| `docs/work-specs/WS-016-first-run-setup.md`     | modify: one line in the implementation record |
| `docs/README.md`, WI-043, WS-043                | statuses                                      |

No new dependencies.

## Data model changes

None.

## API contract

None. `POST /api/v1/setup` keeps its body and status codes.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                             | Covers criterion     |
| --- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| 1   | integration | with a human account present: `404`, the injected hasher was called zero times, nothing created                                                                                  | no hash after setup  |
| 2   | integration | the same with only a deactivated account, and with only an agent account                                                                                                         | no hash after setup  |
| 3   | integration | on an empty database the hasher is called once; the Admin, credential and the two audit entries exist as in WS-016 (existing tests kept)                                         | still works          |
| 4   | integration | 5 concurrent calls with different emails on an empty database: exactly one account; the others are `404` (existing test, kept)                                                   | one Admin            |
| 5   | integration | the hasher passed in creates an account while it runs (the race between the first look and the lock): the call is `404`, and no second account, credential or audit entry exists | second check decides |
| 6   | integration | route: a second `POST /api/v1/setup` is `404` with the unknown-path problem body (existing test, kept)                                                                           | no contract change   |
| 7   | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`                                                                                                                          | gate                 |

## Risks and open questions

1. **One more query on the setup path.** A single `select ... limit 1` on `accounts`;
   negligible against a hash.
2. **The empty-install exposure is not fixed here.** An empty install still hashes for every
   request. **Owner: should `SETUP_TOKEN` (WS-016 question 1) be scheduled now, since it is
   the real fix for that case and is needed before any internet-facing install?**
