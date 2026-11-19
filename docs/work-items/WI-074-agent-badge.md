# WI-074 — Agents where humans see them: the "Agent" badge

- Status: Done (2026-11-19)
- Work-track: [WT-05](../work-tracks/WT-05-agent-accounts-and-tokens.md) (item G,
  decision 10)
- Depends on: WI-071 (done)
- Work-spec: [WS-074](../work-specs/WS-074-agent-badge.md)

## Outcome

Wherever the UI shows the account behind a task or a comment, a human can tell an agent
from a person: the agent's name is followed by an "Agent" badge. The API gives every
client the same information, as a `kind` field (`human` | `agent`) on the reporter of a
task and the author of a comment, an additive change to the response contract. Agents
stay out of every list of people: the people directory, team membership and the assignee
picker.

The activity timeline does not exist yet (WT-08); this item gives it the schema and the
component to use, and nothing else.

## Acceptance criteria

- [x] A task's `reporter` and a comment's `author` carry `kind` (`human` | `agent`) in
      every response that returns them; the OpenAPI document shows it, generated from Zod.
- [x] One shared component shows an account's name and, for an agent, an "Agent" badge
      whose text is visible and read by screen readers; a human's name has no badge.
- [x] The task detail (dialog and page, read and edit views) shows the badge next to an
      agent reporter; the comments list shows it next to an agent author; a `system`
      comment still shows "Opanel" with no badge.
- [x] The task dialog with an agent reporter and an agent comment has no axe violations in
      light and dark mode.
- [x] An agent can never be assigned a task (`400` on `assigneeAccountId`), joins no team,
      and is never listed by `GET /people`, each covered by a test.
- [x] No migration, no new endpoint, no permission change. The full quality gate passes.

## Notes

- The board card and the epics page show no reporter or author today, so they do not
  change. The account menu shows only the signed-in human.
- Item D (WI-073) changes the same two services (`tasks.ts`, `comments.ts`); this item
  rebases on it if D merges first.
