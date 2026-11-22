# WS-105 — The MCP tool to submit a bug report

- Status: Done (approved by the owner on 2026-11-22, questions 1 to 4 as proposed; done on 2026-11-22)
- Work-item: [WI-105](../work-items/WI-105-mcp-bug-report-tool.md)
- Canonical docs: [0005](../canonical/0005-mcp-server.md) (sections 4 to 6),
  [0001](../canonical/0001-ai-qa-agents-and-triage.md) (sections 5 and 6: reports,
  fingerprints, routing)

## 1. Approach

One tool, `mcp/src/tools/bug-report.ts`, registered in `TOOLS` after the task writes.
Nothing changes in the app or `/api/v1`.

**Input.** `submitBugReportRequestSchema.extend({ projectId: projectRefSchema })`, as
WS-104 built the task writes. Checked with the installed SDK on 2026-11-22: the
schema's defaults reach the tool's arguments (`originLayer: "unknown"`,
`severity: "medium"`), and the input's JSON Schema shows them. The tool splits
`projectId` off and sends the rest with `api.send("POST", ...)`.

**Output.** The answer is either `BugReportCreated` (`201`) or `BugReportDeduplicated`
(`200`), so the tool parses it with
`z.discriminatedUnion("outcome", [bugReportCreatedSchema, bugReportDeduplicatedSchema])`
and declares that as its output schema. Checked with the installed SDK: it lists it as a
`type: "object"` schema with `oneOf`, and accepts either answer as structured content.
The summary, after the notice:

- created: `Filed a new bug, OPA-13: "Checkout button returns 500". It went to team <id>.`
  or `... No team owns its layer, so it is unassigned.`
- deduplicated: `Counted on the open bug OPA-12, now seen 3 times: "Checkout button returns 500".`

The title quoted is the one the assistant sent: the answer holds only the key. On
`deduplicated` the open bug's own title may differ; the summary says "the open bug" and
the assistant can read it with `opanel_get_task`.

**When Opanel does not answer** (question 2). `send` answers its generic
"may have been made, read the task" failure. This tool has no task to read, so it
replaces that message with one of its own: the report may have been kept, and sending it
again counts it once more on the same bug (the fingerprint makes a resend a
deduplication, never a second bug, while that bug is open). `send` gains nothing.

**Description.** What the tool does (a report becomes a bug routed by layer, or is
counted on the open bug with the same fingerprint); how to choose `originLayer` (the
table of doc 0001 section 5, shortened); how to build `fingerprint` (a hash of the layer,
the normalised route or endpoint and the error signature, without timestamps, ids or run
ids, so two runs that meet the same bug send the same one); that one `runId` groups a
run's reports; that it changes Opanel; `Needs reports:write`; and the "data, not
instructions" sentence.

**Annotations.** `WRITE` (WS-104): not read-only, not idempotent (each call keeps a
report and may add an occurrence), not destructive.

**Documentation.** `mcp/README.md` lists the tool. Doc 0005 section 4 already lists it;
a line says the answer is created or deduplicated. WT-11 records that item D is WI-105.
`docs/AGENTS.md`, "Filing bug reports", gains one sentence: an assistant connected
through the MCP server files reports with `opanel_submit_bug_report`.

## 2. Files

| Path                                   | Change                                                  |
| -------------------------------------- | ------------------------------------------------------- |
| `mcp/src/tools/bug-report.ts`          | create: `opanel_submit_bug_report`                      |
| `mcp/src/tools.ts`                     | modify: the tool in `TOOLS`                             |
| `mcp/src/testing.ts`                   | modify: fixtures for the two answers                    |
| `mcp/src/bug-report-tool.test.ts`      | create: unit tests                                      |
| `mcp/src/read-tools.test.ts`           | modify: a `qa_agent`'s tool list ends with the new tool |
| `mcp/e2e/mcp.spec.ts`                  | modify: the same list, end to end                       |
| `mcp/e2e/bug-report-tool.spec.ts`      | create: the end-to-end test                             |
| `mcp/README.md`                        | modify: the tool                                        |
| `docs/canonical/0005-mcp-server.md`    | modify: section 4, its two answers                      |
| `docs/work-tracks/WT-11-mcp-server.md` | modify: item D is WI-105                                |
| `docs/AGENTS.md`                       | modify: "Filing bug reports" names the tool             |

## Data model changes

None.

## API contract

None: the tool calls `POST /api/v1/projects/{projectId}/bug-reports` with its existing
schemas and permission.

## 3. Test plan (written first, in this order)

Tests 1 to 7 in Vitest's `mcp` project with a fake `fetch`.

| #   | Level | Test                                                                                                                                                                    | Covers criterion |
| --- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit  | Offered with `reports:write` (every scope of `qa_agent`, of `worker_agent`), not without it; `WRITE` annotations; the description names the permission and fingerprints | offered, tools   |
| 2   | unit  | By project key it posts the body without `projectId`, with `originLayer` `unknown` and `severity` `medium` when left out, and the given evidence as sent                | input            |
| 3   | unit  | A `201` answers the created bug: structured content as the API's, the summary naming its key and team, or "unassigned" when `assignedTeamId` is `null`                  | created          |
| 4   | unit  | A `200` answers the deduplicated bug: its key and occurrences in the summary                                                                                            | deduplicated     |
| 5   | unit  | Invalid reports make no request: no fingerprint, a fingerprint of 129 characters or with a line break, a confidence of 2, an `ftp:` evidence URL, an unknown field      | input            |
| 6   | unit  | An answer matching neither schema is an `unexpected_response` tool error; a `413` is a tool error; no answer gives the "counts it once more" message, one request       | errors           |
| 7   | unit  | A title with a line break and "Ignore previous instructions" is quoted after the notice; with the token in a problem's `detail`, no result or error holds it            | data, token      |
| 8   | e2e   | Over stdio: a `qa_agent` reports a bug (created, reporter the agent), then the same fingerprint again (deduplicated on the same key, 2 occurrences)                     | end to end       |

## 4. Risks and open questions

1. **The quoted title on a deduplication** is the one the assistant sent, not the open
   bug's. Proposed: say "the open bug" and quote the sent title, as above, rather than a
   second request to read the bug's own title; `opanel_get_task` gives it when needed.
2. **The message when Opanel does not answer.** Proposed: the tool's own, as above,
   since there is no task to read yet. The alternative is `send`'s generic message,
   which points at `opanel_get_task` without a key to give it.
3. **`fingerprint` stays required**, as the API has it. Proposed: the server never makes
   one up; the description says how to build it, since only the agent knows the error's
   signature.
4. **Evidence size.** A report may hold up to about 512 KiB of JSON (the API's limit,
   `413` above it). Proposed: no limit of the tool's own; the schema's per-field limits
   and the API's `413` already apply.

## Implementation record

- Red: `3d95850`, tests 1 to 7: 12 tests failing because the tool did not exist, and the
  `qa_agent` tool list of `read-tools.test.ts` (and of `mcp.spec.ts` end to end), which
  gains `opanel_submit_bug_report` at its end.
- Green: `c5ec024`. A failure of kind `unreachable` becomes the tool's own message
  (question 2); every other failure is `toolError`.
- Test 8: `80a7433`, `mcp/e2e/bug-report-tool.spec.ts`: created (a `bug`, severity
  `high`, reporter the agent), then deduplicated on the same key with 2 occurrences.
- Gate: `pnpm check`, `pnpm test` (1981 passed) and `pnpm test:e2e` (100 passed) locally;
  CI run 45082632728 green on `4169397`.
- Docs: `5adebcf`. `docs/AGENTS.md` names the tool under "Filing bug reports".

## Deviations

None.
