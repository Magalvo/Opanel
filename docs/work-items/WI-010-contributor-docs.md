# WI-010 — Contributor docs: README and CONTRIBUTING

- Status: In progress (approved by the owner on 2026-11-12)
- Work-track: [WT-01](../work-tracks/WT-01-project-boilerplate.md)
- Depends on: WI-009
- Work-spec: [WS-010](../work-specs/WS-010-contributor-docs.md)

## Outcome

Someone who has never seen the repository can learn what Opanel is, get it running, run the
quality gate, and understand how a change is proposed and accepted, by reading two files at
the repository root. This is the last item of WT-01.

## Acceptance criteria

- [ ] `README.md` says what Opanel is, that it is early (no features yet), and its licence.
- [ ] `README.md` lists the prerequisites (Node.js, pnpm, Docker) with the versions the
      repository pins, and the steps from a fresh clone to a running app.
- [ ] Following those steps literally on a fresh clone reaches a running app whose
      `/api/v1/health` returns `200`.
- [ ] `README.md` lists every `package.json` script with one line on what it does, and
      names the five quality gate commands.
- [ ] `README.md` shows the CI status badge for `main`.
- [ ] `CONTRIBUTING.md` explains the spec-driven workflow, TDD order, quality gate, commit
      convention and one-item-per-pull-request rule, by summarising and linking to
      `AGENTS.md` rather than restating it.
- [ ] `CONTRIBUTING.md` covers the things that trip up a first run: the three local
      databases, the port override, resetting the database volume, and installing the
      Playwright browser.
- [ ] Both files pass `format:check`, and every relative link in them resolves.

## Notes

No code of conduct, security policy, issue or pull request templates, and no user or API
documentation in this item. `AGENTS.md` stays the single source of the rules; these files
point to it.
