# WI-093 — Optional PostHog add-on: error-tracking issues become Opanel bug reports

- Status: Done (2026-11-20). The manual check with a real PostHog alert is deferred by the
  owner to a follow-up in `docs/README.md`
- Work-track: [WT-13](../work-tracks/WT-13-integrations.md) (item A)
- Depends on: WI-089 (done: `POST /projects/{projectId}/bug-reports` and the triage
  pipeline)
- Work-spec: [WS-093](../work-specs/WS-093-posthog-addon.md)

## Outcome

An **optional add-on**, not part of how Opanel works. An operator who already uses PostHog
for error tracking may choose to run a small bridge, outside Opanel, that
turns each PostHog error-tracking issue into an Opanel bug report. The bridge is an
ordinary agent of `/api/v1`: it authenticates with the token of an agent account (role
`qa_agent`), and Opanel's server, schema and API are unchanged. Repeats of the same
PostHog issue are deduplicated by Opanel, routed to the team of their layer, and every
ticket is attributed to the bridge's agent account.

```
PostHog (error tracking alert)  --webhook-->  bridge  --Bearer opk_...-->
  POST /api/v1/projects/{projectId}/bug-reports  -->  dedupe, route, ticket
```

## Optional by design

The canonical way bugs enter Opanel stays the one of doc 0001: any external QA agent calls
the bug report endpoint. The bridge is one more such agent, offered as a convenience for
PostHog users. Concretely:

- Opanel installs, runs and passes its tests without the add-on. Nothing in `src/`, the
  database schema, the configuration of the app or its container image refers to PostHog
  or to the add-on.
- Enabling it is an operator's choice: create an agent account and token, deploy the
  add-on, point a PostHog webhook at it. Disabling it is revoking that token or stopping
  the add-on; the tickets it filed stay, attributed to its agent account, like any agent's.
- No canonical doc describes it as part of triage. It is documented in its own guide, as
  an example of an integration built on the public API, and the add-on can be removed
  from the repository later without touching the app.
- It ships separately from the Opanel image (its own package and its own image), never as a default part of an install.

## Acceptance criteria

- [ ] Opanel's own quality gate and its container image do not depend on the add-on:
      removing the add-on's directory leaves `pnpm typecheck`, `lint`, `test`, `test:e2e`
      and the image build green (checked once in WS-093, then by CI keeping the add-on's
      job separate from the app's).
- [ ] The bridge accepts PostHog's webhook for an error-tracking issue and answers it
      only when the request proves it came from the configured PostHog source (a shared
      secret or signature, as WS-093 settles); any other request is refused and nothing is
      sent to Opanel.
- [ ] Each accepted issue is submitted as one bug report whose `fingerprint` is derived
      only from the PostHog project and issue id, so every repeat of that issue lands on
      the same open task (`200 deduplicated`) and a repeat after the task is closed opens a
      new task with a `regression of` link (doc 0001 section 6).
- [ ] The report's fields are mapped as WS-093 specifies: `title` from the exception,
      `severity` from a documented rule, `summary` with links back to the PostHog issue and
      to a session replay when one exists, `evidence` with the stack trace, URL and
      exception details, all within the size caps of doc 0001 section 5.
- [ ] `originLayer` follows a documented, tested rule (for example: an exception captured
      by a browser SDK is `frontend`, one captured by a server SDK is `backend`, anything
      else is `unknown`), with `confidence` set accordingly. `unknown` reaches the
      project's fallback triage team.
- [ ] The PostHog-project-to-Opanel-project mapping, the Opanel URL, the token and the
      webhook secret come from environment variables validated with Zod at start-up. A
      missing or invalid value stops the bridge with a message that does not print the
      secret.
- [ ] The token and the webhook secret never appear in a log line, an error or a
      response (tested).
- [ ] Opanel's answers are handled: `201` and `200` are success; `429` and `5xx` are
      retried with backoff (safe, since submission is idempotent through the fingerprint,
      doc 0004); `400`, `401`, `403` and `404` are logged and not retried.
- [ ] The bridge has no database access and imports the request and response schemas
      from `src/lib/schemas/`, like the MCP server (doc 0005).
- [ ] Unit tests cover the mapping and the layer rule; an integration test sends a
      recorded PostHog payload through the bridge to the real app and finds the routed
      task and its report. The full quality gate passes, and the add-on's own build and
      tests pass in their own CI job.
- [ ] An operator guide explains creating the agent account and token, deploying the
      bridge, and configuring the webhook in PostHog.

## Owner decisions (2026-11-20)

1. **Track.** The item opens a new work-track,
   [WT-13 Integrations](../work-tracks/WT-13-integrations.md), for optional add-ons built on
   the public API. The owner wants this add-on even though WT-11 leaves out a reference QA
   agent: it is an integration, not part of the MCP server.
2. **Location.** `addons/posthog/`, a workspace package kept out of the app's build, which
   imports the shared schemas of `src/lib/schemas/`. AGENTS.md section 3 lists `addons/`.
3. **Runtime.** A plain Node HTTP server shipped as its own optional container image,
   separate from Opanel's image.
4. **Dependencies.** None beyond Zod is expected (plain `fetch` and Node's HTTP server).
   If WS-093 needs a PostHog SDK, that is a canonical doc change first (AGENTS.md section
   2).
5. **Bridge or template.** WS-093 reads PostHog's current documentation for the webhook
   payload, its authentication and the issue fields (hard rule 13), and chooses: a
   documented PostHog webhook template with no code, if it can produce the bug report
   contract (fingerprint, `originLayer`, authentication) on its own; otherwise the bridge
   this item describes. If the template is chosen, the criteria about the bridge's code
   become criteria about the template and its guide, and WS-093 says which.

## Notes

- Not in scope: Opanel → PostHog (Opanel as a source for PostHog's Self-driving inbox,
  linking PostHog's pull requests to tasks). Opanel has no webhooks in v1 (doc 0001
  section 9, doc 0004), and `worker_agent` is reserved.
- Not in scope: instrumenting Opanel itself with PostHog. That adds a dependency and needs
  a canonical doc change first.
- Session replays stay in PostHog; the report carries a link. Attachments are out of v1.
- WS-093 chose the template path (decision 5). Section 4 of WS-093 says which test covers
  each criterion above and which criteria about a bridge service it replaces.
