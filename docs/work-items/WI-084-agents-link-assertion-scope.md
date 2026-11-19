# WI-084 — The Manager's Agents-link check looks only at the sidebar

- Status: Proposed
- Work-track: none: a fix to the end-to-end suite (flaky test reported on 2026-11-19)
- Depends on: none
- Work-spec: [WS-084](../work-specs/WS-084-agents-link-assertion-scope.md)

## Outcome

The end-to-end test "a Manager has neither the Agents link nor the page"
(`tests/e2e/agents.spec.ts`, WS-077 test 10) checks that no link named "Agents" is on
`/projects`:

```ts
await expect(page.getByRole("link", { name: "Agents" })).toHaveCount(0);
```

Playwright matches `name` as a case-insensitive substring, and the same spec creates projects
named `Agents <KEY>` (`createProject`). The projects list is ordered by name, so once those
projects are on its first page the locator finds project links such as "Agents AA41F05C" and
the test fails with "Expected: 0, Received: 2". On 2026-11-19 it failed 3 of 3 with
`--repeat-each=3`, on a freshly recreated end-to-end database, on `main` as well as on
feature branches. Whether it fails depends on worker order and on the data in the database.

After this item the check looks only at the Main navigation (the sidebar) and only at a link
named exactly "Agents", as the line above it already does for "Projects". Project names can no
longer affect the result. The product does not change.

## Acceptance criteria

- [ ] The Manager test asserts that the Main navigation has no link named exactly "Agents",
      and still asserts that `/agents` is a `404`.
- [ ] `pnpm test:e2e tests/e2e/agents.spec.ts --retries=0 --repeat-each=3` passes, with
      `Agents <KEY>` projects on the first page of `/projects`.
- [ ] No `getByRole("link", { name: "Agents" })` in `tests/e2e/` is left without a
      Main-navigation scope and `exact: true`.
- [ ] The full quality gate passes.

## Notes

`tests/e2e/people.spec.ts:144` ("People", on `/`) and `tests/e2e/projects.spec.ts:133`
("Settings", on a project page) use the same unscoped `toHaveCount(0)` pattern. No test data
matches them today, so they do not fail. They are recorded under Follow-ups in
`docs/README.md`, not changed here (one work-item per branch).
