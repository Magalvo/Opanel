import { expect, test } from "@playwright/test";

import { taskSchema } from "@/lib/schemas/tasks";

import { bugReportAnswerSchema } from "../src/tools/bug-report";
import { agentWithToken, headers, json, startServer, uniqueId } from "./agent";

// WS-105 test 8: a qa_agent's assistant reports a bug over stdio, which is created with the
// agent as its reporter, then reports it again, which is counted on the same bug.

test("an agent's assistant files a bug, then the same bug again (WS-105)", async ({ request }) => {
  const agent = await agentWithToken(request);
  const id = uniqueId();
  const key = `B${id.slice(0, 6).toUpperCase()}`;
  await json(
    await request.post("/api/v1/projects", { headers, data: { key, name: `MCP bugs ${id}` } }),
    201,
  );
  const report = {
    projectId: key,
    title: "Checkout button returns 500",
    originLayer: "api",
    severity: "high",
    fingerprint: `mcp-e2e-${id}`,
    evidence: { http: { method: "POST", path: "/api/orders", status: 500 } },
  };

  const { client, stderr } = await startServer(agent.token);
  try {
    const submit = async () => {
      const result = await client.callTool({
        name: "opanel_submit_bug_report",
        arguments: report,
      });
      expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
      expect(JSON.stringify(result)).not.toContain(agent.token);
      return bugReportAnswerSchema.parse(result.structuredContent);
    };

    const first = await submit();
    if (first.outcome !== "created") throw new Error(`expected created, got ${first.outcome}`);

    const bug = taskSchema.parse(
      await json(await request.get(`/api/v1/tasks/${first.taskKey}`, { headers }), 200),
    );
    expect(bug.type).toBe("bug");
    expect(bug.severity).toBe("high");
    expect(bug.reporter.id).toBe(agent.agentId);

    const second = await submit();
    expect(second).toEqual({
      outcome: "deduplicated",
      taskId: first.taskId,
      taskKey: first.taskKey,
      occurrences: 2,
    });
  } finally {
    await client.close();
  }
  expect(stderr()).not.toContain(agent.token);
});
