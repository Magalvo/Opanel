# PostHog add-on (optional)

Turns PostHog error-tracking issues into Opanel bug reports. It is **optional**: Opanel
works exactly the same without it, and nothing in the app depends on it (WT-13, WS-092).

There is nothing to install or run. The add-on is a set of webhook bodies you paste into a
PostHog error-tracking alert. PostHog then calls Opanel's public bug report endpoint with
the token of an Opanel agent, like any other QA agent (canonical doc 0001). Opanel
deduplicates the reports, routes them to the team of their layer and records the agent as
the reporter.

```
PostHog alert (issue created, reopened or spiking)
  --HTTP webhook, Authorization: Bearer <token>-->
POST /api/v1/projects/<project key>/bug-reports  -->  dedupe, routing, a bug task
```

## 1. In Opanel (an Admin)

1. **Agents → New agent.** Name it, for example, `PostHog`. Role `qa_agent`. Keep only the
   scopes `projects:read` and `reports:write`, and restrict it to the project(s) PostHog
   reports on.
2. **Create token.** Copy it now: Opanel shows it once. Do not store it anywhere else than
   PostHog's secret headers (step 2).
3. Set the project's triage settings: the team for each layer (`frontend`, `api`,
   `backend`) and the triage team, which receives everything PostHog cannot place. Until
   the app has a page for this, a Manager or Admin sets them through the API:
   `GET /api/v1/projects/<project key>/triage` for the current `version`, then
   `PATCH` the same path with `{"triageTeamId": "<team id>", "rules": {"frontend":
"<team id>", "backend": "<team id>"}, "version": <version>}`.

## 2. In PostHog

Error tracking → Configuration → **Alerting** → **New notification** → **HTTP Webhook**.

| Field          | Value                                                                  |
| -------------- | ---------------------------------------------------------------------- |
| Webhook URL    | `https://<your Opanel host>/api/v1/projects/<project key>/bug-reports` |
| Method         | `POST`                                                                 |
| JSON Body      | the content of one file from [`bodies/`](bodies/), see below           |
| Headers        | `Content-Type: application/json`                                       |
| Secret headers | `Authorization` = `Bearer <the token from step 1>`                     |

Put the token in **Secret headers**, never in Headers: PostHog encrypts secret headers,
hides them after saving and keeps them out of its logs.

Choose one of two set-ups per Opanel project.

### Basic: one alert

One alert with [`body-unknown.json`](bodies/body-unknown.json), triggered on **issue
created**, **issue reopened** and, if spike detection is on, **issue spiking**. Every bug
goes to the project's triage team, which re-routes it.

### Routed: two or three alerts

PostHog knows which SDK captured an exception (`$lib`); the alert's property filters use
it to pick the layer.

| Alert    | Triggers           | Filter                                                                                              | Body                                              |
| -------- | ------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Frontend | created, reopened  | `$lib` is one of `web`, `posthog-react-native`, `posthog-ios`, `posthog-android`, `posthog-flutter` | [`body-frontend.json`](bodies/body-frontend.json) |
| Backend  | created, reopened  | `$lib` is set and is none of the values above                                                       | [`body-backend.json`](bodies/body-backend.json)   |
| Spikes   | spiking (optional) | none: spike alerts carry no `$lib`                                                                  | [`body-unknown.json`](bodies/body-unknown.json)   |

A client SDK that PostHog adds later lands in Backend until you add it to the Frontend
list. Humans can always re-route a bug in Opanel.

### Test it

On the alert's page, **Test function** sends an example to Opanel. Turn on **Log
responses** to see Opanel's answer: `201` created a bug, `200` counted it on an open one.
`401` means the token is wrong, revoked or expired; `403` that the agent may not reach
that project or lacks `reports:write`; `400` that the body was changed into something the
contract refuses.

## 3. What to expect

- **One bug per PostHog issue.** The fingerprint is `posthog:<PostHog project>:<issue id>`,
  so a reopened or spiking issue is counted on the bug that is still open. If that bug is
  already done in Opanel, a new bug is created with a `regression of` link to it.
- **`occurrences` counts PostHog alerts, not exceptions.** PostHog alerts on new, reopened
  and spiking issues, not on every exception; open the issue in PostHog for its volume.
- **Evidence stays in PostHog.** The bug's summary links to the PostHog issue, where the
  stack trace and session replays are.
- **Severity is `medium`.** Change `severity` in a body to `low`, `high` or `critical` for
  that alert if you want another default.
- PostHog retries Opanel's `429` and `5xx` answers, so a burst after a bad release arrives
  late rather than lost.

## Limits

- An issue title over 200 characters is refused (`400`), and PostHog does not retry it.
  Exception class names are short, so this is rare; the alert's logs show it.
- Edit a body only by changing fixed text or `severity`. The placeholders (`{…}`) must stay
  plain paths that PostHog fills in; the add-on's tests check the bodies as shipped.

## Removing it

Disable or delete the PostHog alerts, then revoke the agent's token (Agents → the agent → the
token's Revoke button) or disable the agent. Bugs already filed stay, attributed to the agent.

## For contributors

The bodies are tested against Opanel's real contract, apart from the app's own checks:

```
pnpm exec tsc -p addons/posthog --noEmit
pnpm exec vitest run --config addons/posthog/vitest.config.ts
pnpm exec playwright test --config addons/posthog/playwright.config.ts
```

The end-to-end test needs the database (`docker compose up -d`) and starts the app on
port 3200. Nothing in `src/`, `tests/` or `scripts/` may import from `addons/`; a test
checks it.
