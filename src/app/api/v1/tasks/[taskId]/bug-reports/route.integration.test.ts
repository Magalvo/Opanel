import { describe, expect, it } from "vitest";

import { submitBugReportRequestSchema } from "@/lib/schemas/bug-reports";
import { bugReportPageSchema } from "@/lib/schemas/task-bug-reports";
import { agentActor } from "@/server/auth/actor";
import {
  apiRequest,
  bearerRequest,
  createTestAccount,
  createTestAgent,
  createTestToken,
  signInCookie,
  testActor,
} from "@/server/auth/testing";
import { fileBugReport } from "@/server/services/bug-reports";
import { createProject } from "@/server/services/projects";

import { GET } from "./route";

const task = { params: Promise.resolve({ taskId: "OPA-1" }) };

describe("GET /api/v1/tasks/{taskId}/bug-reports (WS-090)", () => {
  it("lets a Viewer and an agent with tasks:read read; checks limit and the restriction", async () => {
    const manager = testActor(
      await createTestAccount({ name: "Manager", email: "manager@example.com", role: "manager" }),
    );
    await createProject(manager, { key: "OPA", name: "Opanel" });
    const other = await createProject(manager, { key: "WEB", name: "Web" });
    const filer = await createTestAgent({ scopes: ["reports:write"] });
    await fileBugReport(
      agentActor({
        accountId: filer.id,
        role: "qa_agent",
        scopes: ["reports:write"],
        projectIds: null,
      }),
      "OPA",
      submitBugReportRequestSchema.parse({ title: "Crash", fingerprint: "fp" }),
    );
    await createTestAccount({ name: "Vic", email: "vic@example.com", role: "viewer" });
    const viewer = await signInCookie("vic@example.com");

    const byViewer = await GET(
      apiRequest("GET", "/api/v1/tasks/OPA-1/bug-reports", { cookie: viewer }),
      task,
    );
    expect(byViewer.status).toBe(200);
    expect(bugReportPageSchema.parse(await byViewer.json()).items).toHaveLength(1);

    const reader = await createTestAgent({ name: "Reader", scopes: ["tasks:read"] });
    const { token } = await createTestToken(reader.id);
    const byToken = await GET(bearerRequest("/api/v1/tasks/OPA-1/bug-reports", token), task);
    expect(byToken.status).toBe(200);

    const tooMany = await GET(
      apiRequest("GET", "/api/v1/tasks/OPA-1/bug-reports?limit=26", { cookie: viewer }),
      task,
    );
    expect(tooMany.status).toBe(400);

    const restricted = await createTestAgent({
      name: "Restricted",
      scopes: ["tasks:read"],
      projectIds: [other.id],
    });
    const restrictedToken = (await createTestToken(restricted.id)).token;
    const refused = await GET(
      bearerRequest("/api/v1/tasks/OPA-1/bug-reports", restrictedToken),
      task,
    );
    expect(refused.status).toBe(403);
  });
});
