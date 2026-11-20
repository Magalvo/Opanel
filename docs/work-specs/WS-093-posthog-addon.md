# WS-093 — Optional PostHog add-on: error-tracking issues become Opanel bug reports

- Status: Done (2026-11-20). The manual PostHog check of section 4 is deferred (see the
  implementation record)
- Work-item: [WI-093](../work-items/WI-093-posthog-addon.md)
- Work-track: [WT-13](../work-tracks/WT-13-integrations.md)
- Canonical docs: [0001](../canonical/0001-ai-qa-agents-and-triage.md) sections 3 to 6 (agent
  accounts, tokens, the bug report contract, triage),
  [0004](../canonical/0004-api-conventions.md) (idempotency through the fingerprint)

## 1. What PostHog offers (read on 2026-11-20)

WI-093 decision 5 asks this spec to read PostHog's current documentation and choose between
a bridge service and a documented PostHog template. Sources: PostHog's docs pages
"Send error tracking alerts" and "Send PostHog event data using webhooks", and in the
`PostHog/posthog` repository on GitHub, the HTTP webhook destination
(`nodejs/src/cdp/templates/_destinations/webhook/webhook.template.ts`), its fetch helper
(`nodejs/src/cdp/utils/cdp-fetch.ts`) and the error-tracking alert reference
(`products/error_tracking/skills/authoring-error-tracking-alerts/`).

| Need of the bug report contract (doc 0001 §5) | What PostHog provides                                                                                                                                                                                                                   |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A trigger per error-tracking issue            | Error-tracking alerts fire the events `$error_tracking_issue_created`, `$error_tracking_issue_reopened` and `$error_tracking_issue_spiking`, and can deliver to an "HTTP Webhook".                                                      |
| Our JSON body, not PostHog's                  | The webhook's "JSON Body" is a template: string values may hold placeholders such as `{event.properties.name}`, `{event.distinct_id}` and `{project.id}`.                                                                               |
| `Authorization: Bearer opk_…`                 | "Secret headers": encrypted, hidden after saving, kept out of PostHog's logs, sent as entered.                                                                                                                                          |
| A stable fingerprint per issue                | `event.distinct_id` is the issue id, the same on all three events of one issue.                                                                                                                                                         |
| Retries when Opanel answers `429` or `5xx`    | PostHog's fetch retries `429`, `500`, `502` and `503` with backoff. Other `4xx` fail the run and are shown in the destination's logs.                                                                                                   |
| A hint of the layer                           | On `_created` and `_reopened`, the originating `$exception` event's properties are spread onto the alert event, `$lib` (the SDK that captured it) among them, so an alert can be filtered by `$lib`. `_spiking` has no such properties. |
| Evidence                                      | `event.properties.name` (issue title), `event.properties.description` (truncated message), `event.properties.fingerprint` and `exception_timestamp` (for the issue's deep link), `{project.url}`.                                       |

## 2. Decision: the template path, no bridge code

Every need above is met by PostHog's own webhook, so the add-on is **documented PostHog
webhook bodies plus an operator guide**, kept and tested in `addons/posthog/`. There is no
service to run, so:

- WI-093 decision 3 (a container image) does not apply: nothing is deployed. If the
  template path ever proves insufficient, a bridge is a new work-item in WT-13.
- Nothing in Opanel changes: no endpoint, no schema, no migration.
- The add-on does not hold or see the token. The operator pastes it into PostHog's secret
  headers; it never enters the repository (hard rule 7).

### How the layer is chosen

A webhook body is static apart from its placeholders, so the layer comes from **which
alert fired**, not from logic in the body. The guide offers two set-ups per Opanel project:

- **Basic: one alert.** Body `body-unknown.json`: `originLayer` `unknown`, so every issue
  reaches the project's fallback triage team (doc 0001 §6). Covers all three triggers.
- **Routed: two alerts**, filtered on `$lib`:
  - `body-frontend.json`, for `$lib` in the client SDKs (`web`, `posthog-react-native`,
    `posthog-ios`, `posthog-android`, `posthog-flutter`): `originLayer` `frontend`,
    `confidence` `0.6`.
  - `body-backend.json`, for every other `$lib` that is set: `originLayer` `backend`,
    `confidence` `0.5`. A server-side exception may be an API fault, but the SDK cannot
    tell; `backend` is the closer default and humans can re-route (doc 0001 §6).
  - `_spiking` has no `$lib`, so in this set-up it goes through an optional third alert
    with `body-unknown.json`.

The exact list of client `$lib` values is checked against PostHog's SDK docs during step 1
of the implementation and recorded in the guide.

### The body

All three files share one shape; only `originLayer`, `confidence` and the diagnosis
sentence differ. `body-frontend.json`:

```json
{
  "title": "{event.properties.name}",
  "fingerprint": "posthog:{project.id}:{event.distinct_id}",
  "originLayer": "frontend",
  "confidence": 0.6,
  "severity": "medium",
  "summary": "Reported by PostHog error tracking ({event.event}).\n\n{event.properties.description}\n\nIssue: {project.url}/error-tracking/fingerprint/{event.properties.fingerprint}?timestamp={event.properties.exception_timestamp}",
  "evidence": {
    "actual": "{event.properties.description}",
    "diagnosis": "Captured by the PostHog SDK `{event.properties.$lib}`, a client SDK, so the fault is likely in the frontend."
  }
}
```

Choices, each tied to the contract of `submitBugReportRequestSchema`:

- **Fingerprint** `posthog:<PostHog project id>:<issue id>`: printable ASCII, under 128
  characters for a UUID issue id. Every repeat of an issue (`_reopened`, `_spiking`) lands
  on the open task (`200 deduplicated`); after the task is closed in Opanel a repeat opens a
  new task with a `regression of` link. `occurrences` therefore counts PostHog alerts, not
  exceptions; the guide says so.
- **Severity** is the constant `medium`; the operator may change it per alert. PostHog
  alerts carry no impact measure on `_created`.
- **No `evidence.url`**: a placeholder for a missing property would render an empty
  string, which the contract refuses (`400`). The issue link goes in `summary`, as text.
- **No `runId`**, **no `stepsToReproduce`**: PostHog has neither.
- The fixed text is in English, like every report Opanel stores.

## 3. Files

| Path                                       | Change | Purpose                                                                                                                               |
| ------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `addons/posthog/README.md`                 | create | Operator guide (section 5)                                                                                                            |
| `addons/posthog/bodies/body-unknown.json`  | create | Webhook body, layer `unknown`                                                                                                         |
| `addons/posthog/bodies/body-frontend.json` | create | Webhook body, layer `frontend`                                                                                                        |
| `addons/posthog/bodies/body-backend.json`  | create | Webhook body, layer `backend`                                                                                                         |
| `addons/posthog/fixtures/*.json`           | create | Alert events built from PostHog's documented properties: created (`web`, `posthog-node`), reopened, spiking, and one with a long name |
| `addons/posthog/tests/render.ts`           | create | Test helper: replaces `{a.b.c}` placeholders from a fixture, the way PostHog renders plain paths                                      |
| `addons/posthog/tests/bodies.test.ts`      | create | Unit tests (section 4)                                                                                                                |
| `addons/posthog/e2e/posthog.spec.ts`       | create | End-to-end test against the real app (section 4)                                                                                      |
| `addons/posthog/vitest.config.ts`          | create | The add-on's unit tests, apart from the app's projects                                                                                |
| `addons/posthog/playwright.config.ts`      | create | Starts the app as `playwright.config.ts` does, on its own port, and runs the add-on's spec                                            |
| `addons/posthog/tsconfig.json`             | create | Extends the root config; includes the add-on, `src/lib/schemas` and `tests/e2e` helpers it imports                                    |
| `tsconfig.json`                            | modify | `exclude` gains `addons`, so the app's `typecheck` never compiles the add-on                                                          |
| `.dockerignore`                            | modify | Gains `addons`, so the image's build context never holds it                                                                           |
| `.github/workflows/ci.yml`                 | modify | New job "Add-ons", separate from "Quality gate": typecheck, unit tests and end-to-end test of `addons/posthog`                        |
| `docs/README.md`, WI-093, WT-13            | modify | Statuses and the record of this item                                                                                                  |

The add-on uses the repository's existing dev dependencies (`zod`, `vitest`,
`@playwright/test`, `typescript`); `package.json` and `pnpm-lock.yaml` do not change, and
no workspace package is needed, since nothing is built or published. ESLint and Prettier
keep running over the whole repository, add-on included: they are style guardrails, not a
build dependency.

Imports go one way only: the add-on's tests import `src/lib/schemas/bug-reports.ts` and the
helpers of `tests/e2e/` (`seed.ts`, `environment.ts`); nothing under `src/`, `tests/` or
`scripts/` imports from `addons/`. Unit test 6 enforces this.

## Data model changes

None.

## API contract

None. The add-on calls `POST /api/v1/projects/{projectId}/bug-reports` as any agent does.

## 4. Test plan (written first, in this order)

| #   | Level | Test                                                                                                                                                                                                                                                           | Covers (WI-093)      |
| --- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| 1   | unit  | Each body, rendered with each fixture it is meant for, parses with `submitBugReportRequestSchema`                                                                                                                                                              | mapping, size caps   |
| 2   | unit  | Each body uses only plain placeholder paths (no expressions), and only paths the fixtures define, so a typo or an unsupported path fails here, not in PostHog                                                                                                  | mapping              |
| 3   | unit  | The fingerprint is the same for the created, reopened and spiking fixtures of one issue, differs between issues and PostHog projects, and is at most 128 printable ASCII characters                                                                            | fingerprint, dedupe  |
| 4   | unit  | `originLayer` and `confidence` of each body match section 2; `body-unknown.json` has no `confidence`                                                                                                                                                           | layer rule           |
| 5   | unit  | No body sets a header or holds a string that looks like a token (`opk_`); no file under `addons/` does                                                                                                                                                         | secrets              |
| 6   | unit  | No file under `src/`, `tests/` or `scripts/` imports from `addons/`, and the root `tsconfig.json` and `.dockerignore` exclude `addons`                                                                                                                         | optional by design   |
| 7   | unit  | The fixture with a 300-character issue name renders a title the contract refuses: documents the limit the guide warns about (section 6, risk 2)                                                                                                                | mapping, guide       |
| 8   | e2e   | Against the running app, with a seeded `qa_agent` token and a project whose `frontend` layer routes to a team: posting `body-frontend.json` rendered with the `web` created fixture answers `201` and the task is assigned to that team, reported by the agent | routing, attribution |
| 9   | e2e   | Posting the reopened fixture of the same issue answers `200 deduplicated` on the same task with `occurrences` 2                                                                                                                                                | dedupe               |
| 10  | e2e   | `body-unknown.json` with the spiking fixture of another issue reaches the project's triage team                                                                                                                                                                | `unknown` → triage   |

Tests 8 to 10 post the rendered body with `Authorization: Bearer`, as PostHog's webhook
does; they test the bodies against the real contract and the real triage pipeline, not
PostHog itself. Before marking the item done, the implementer also sends one real alert
from a PostHog project (its "Test function" button) to a local Opanel through a tunnel and
records the result in the implementation record; this is a manual check, not a CI test.

The WI-093 criteria about a bridge service (webhook authentication, Zod-validated
environment, retries in our code, an HTTP server) are replaced by: PostHog authenticates to
Opanel with the agent's token in a secret header (Opanel already refuses anything else with
`401`), configuration lives in PostHog's alert, and PostHog retries `429` and `5xx`
(section 1). The criterion "removing `addons/` leaves the app green" is covered by test 6
and checked once by hand: the implementer deletes `addons/` in a scratch copy and runs the
quality gate and `docker build`, and records it.

## 5. Operator guide (`addons/posthog/README.md`)

1. What the add-on is and is not: optional, a PostHog alert that files bug reports through
   the public API; Opanel works the same without it.
2. In Opanel, as an Admin: create an agent account (role `qa_agent`, scopes
   `projects:read` and `reports:write` are enough), restrict it to the project(s) PostHog
   reports on, and create a token. Configure the project's routing rules and triage team.
3. In PostHog: error tracking → Configuration → Alerting → New notification → HTTP
   Webhook. URL `https://<opanel host>/api/v1/projects/<project key>/bug-reports`, method
   `POST`, JSON body from `bodies/`, secret header `Authorization: Bearer <token>`.
   Triggers: created and reopened (and spiking, for the basic set-up). For the routed
   set-up, the `$lib` filters of section 2.
4. Testing with "Test function", and reading failures in the destination's logs.
5. What to expect: one task per PostHog issue, repeats counted on it, a regression task
   when a closed issue comes back, `occurrences` counting alerts.
6. Limits: titles over 200 characters are refused; the PostHog issue link is the only way
   to the stack trace and replays.
7. Removing it: disable the PostHog alert and revoke the token. Tasks already filed stay,
   attributed to the agent.

## 6. Risks and open questions

1. **Placeholder syntax inside longer strings** (`posthog:{project.id}:{event.distinct_id}`
   and the summary) is assumed from PostHog's templating docs. Step 1 of the
   implementation verifies it with PostHog's "Test function"; if only whole-value
   placeholders work, the fingerprint becomes `{event.distinct_id}` alone and the summary
   loses its link, and this spec is amended before going on. **Answered in step 1** (see
   the implementation record): PostHog compiles each templated value as a Hog f-string.
2. **Long issue names.** A title over 200 characters gets `400`, which PostHog does not
   retry. Exception class names are short, so this is documented, not worked around.
   PostHog's templating may allow truncation; if step 1 shows it does, the body uses it and
   test 7 changes to expect a valid title.
3. **`$lib` values** for the routed set-up come from PostHog's SDKs and may grow; the
   backend alert's "every other set `$lib`" filter keeps new server SDKs covered, and a new
   client SDK lands in `backend` until the guide's list is updated.
4. **No CI test of PostHog itself.** Tests prove the bodies satisfy Opanel's contract; the
   PostHog side rests on its documentation and the one manual check above.
5. **Opanel's per-token rate limit** may answer `429` in a burst after a bad release;
   PostHog retries those, so reports arrive late, not lost.

## Implementation record

- Step 1, the placeholder syntax (risk 1), was checked in PostHog's source, not with "Test
  function": this session had no PostHog account. In `PostHog/posthog`,
  `nodejs/src/cdp/services/hog-inputs.service.test.ts` compiles a `templating: 'hog'`
  input `event: "{event.event}"` to the f-string `f'event: "{event.event}"'`, so
  placeholders inside longer strings work. The bodies keep the fingerprint and summary of
  section 2.
- Risk 2 is unchanged: truncating the title would need a Hog expression, and the bodies use
  plain paths only (test 2). Test 7 still expects the long title to be refused.
- Red: the unit tests failed for the right reasons: 16 of 17, with the bodies missing
  (`ENOENT`) and `tsconfig.json` without `addons` in `exclude`. The token test passed
  from the start, as it should for an add-on with no token in it. The import test first
  timed out at 5 s (one `expect` per file), and was rewritten to collect offenders.
- Green: 17 of 17 unit tests once the three bodies, the `tsconfig.json` exclusion and the
  `.dockerignore` line existed.
- The end-to-end test (tests 8 to 10) was written before the bodies but first ran after
  them, so it was never seen red. It passed on its first run.
- Removing `addons/` (WT-13 exit criterion), checked by hand on 2026-11-20: with the
  directory moved aside, `tsc --noEmit` and `eslint . --max-warnings 0` pass. `docker
build .` passes with the directory in place, and the image has no `/app/addons`.
- Gate on 2026-11-20:
  - typecheck, lint and Prettier pass;
  - Vitest 1709 of 1709. The first full run had 16 failures while a `docker build` ran
    at the same time; the second run, alone, passed every test;
  - the add-on: `tsc -p addons/posthog` passes, Vitest 17 of 17, Playwright 1 of 1;
  - `pnpm test:e2e --retries=0`: 88 of 88;
  - Windows 11, Node 24.18.0, Compose PostgreSQL on port 5433, databases
    `opanel_wi092_test` and `opanel_wi092_e2e_test`.
- **Deferred by the owner on 2026-11-20:** the manual check of section 4, one real alert
  from a PostHog project to a local Opanel through a tunnel. The owner has no PostHog
  project yet; the item is done without it, and the check is a follow-up in
  `docs/README.md`.

## Deviations

- `addons/posthog/e2e/environment.ts` was added: the add-on's port (3200) and base URL,
  shared by its Playwright config and spec. Not in the files table of section 3.
- The guide first set the triage settings through the API. WI-092 (the project's Triage
  settings section, merged to `main` while this item was open) added a page for them, and
  the guide now points to it.
- **Renumbered from WI-092 to WI-093.** This item was drafted as WI-092 while another
  session used the same number for the Triage settings section, which reached `main`
  first. On merging `main`, these docs became WI-093 and WS-093. The first three commits
  of this branch still say "(WI-092)" in their messages; they were not rewritten, since the
  branch was already pushed.
- In the end-to-end test the agent holds only `projects:read` and `reports:write` and is
  restricted to its project, as the guide tells operators to do.
