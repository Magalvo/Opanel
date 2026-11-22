# WI-105 — The MCP tool to submit a bug report

- Status: In progress
- Work-track: [WT-11](../work-tracks/WT-11-mcp-server.md) (item D)
- Depends on: [WI-104](WI-104-mcp-write-tools.md) (done), WT-06 (done: the bug-report
  endpoint)
- Work-spec: [WS-105](../work-specs/WS-105-mcp-bug-report-tool.md)

## Outcome

An AI assistant testing a product through the Opanel MCP server can file what it finds:
`opanel_submit_bug_report` sends a structured bug report to a project, and Opanel's
triage turns it into a bug routed to the team of its layer, or counts it on the open bug
with the same fingerprint. The assistant learns which of the two happened, and which task
holds the bug.

## Acceptance criteria

- [ ] `opanel_submit_bug_report` is added, as doc 0005 section 4 lists it, over
      `POST /projects/{projectId}/bug-reports`. It is offered only to an agent holding
      `reports:write`; its description names the permission, says the tool changes Opanel,
      and explains how to build a fingerprint (doc 0001 section 5).
- [ ] It takes a project id or key and the fields of `submitBugReportRequestSchema`,
      validated with that schema before any request; an invalid report makes no request.
      Left out, `originLayer` is `unknown` and `severity` is `medium`, as the API does.
- [ ] A `201` answers "created": the bug's key and the team it went to, or that no team
      owns the layer. A `200` answers "deduplicated": the open bug's key and its
      occurrences. Both are parsed with the endpoint's response schemas; an answer that
      matches neither is a tool error.
- [ ] API problems (`400`, `403`, `404`, `409 project_archived`, `413`) are tool errors as
      in WI-099. When Opanel does not answer, the error says the report may have been
      kept, and that sending it again counts it once more on the same bug.
- [ ] The report's title is quoted in the answer, after the notice that it is data, not
      instructions; the token never appears in a result or error (tested).
- [ ] An end-to-end test drives the built server over stdio against the running app: a
      `qa_agent` reports a bug, which is created with the agent as its reporter, then
      reports it again with the same fingerprint, which is counted on the same bug.

## Notes

WT-11 item D, doc 0005 section 4, doc 0001 sections 5 and 6. No endpoint or permission
changes. WT-11 item E, the operator guide, follows separately.
