import { describe, expect, it } from "vitest";

import { bugReportCreatedSchema, bugReportDeduplicatedSchema } from "@/lib/schemas/bug-reports";
import { problemSchema } from "@/lib/schemas/problem";
import {
  apiRequest,
  bearerRequest,
  createTestAccount,
  createTestAgent,
  createTestToken,
  signInCookie,
} from "@/server/auth/testing";

import { POST as createProject } from "../../route";
import { POST } from "./route";

const project = { params: Promise.resolve({ projectId: "OPA" }) };

const body = {
  title: "Checkout returns 500",
  fingerprint: "api:/orders:500",
  originLayer: "api",
  evidence: { http: { method: "POST", path: "/api/orders", status: 500 } },
};

function file(token: string, payload: unknown) {
  return POST(
    bearerRequest("/api/v1/projects/OPA/bug-reports", token, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
    project,
  );
}

describe("POST /api/v1/projects/{projectId}/bug-reports (WS-089)", () => {
  it("creates, then counts, through route() with an agent's token; a person gets 403", async () => {
    await createTestAccount({ name: "Admin", email: "admin@example.com", role: "admin" });
    const admin = await signInCookie("admin@example.com");
    await createProject(
      apiRequest("POST", "/api/v1/projects", { cookie: admin, body: { key: "OPA", name: "O" } }),
      undefined,
    );
    const agent = await createTestAgent({ scopes: ["projects:read", "reports:write"] });
    const { token } = await createTestToken(agent.id);

    const created = await file(token, body);
    expect(created.status).toBe(201);
    expect(bugReportCreatedSchema.parse(await created.json())).toMatchObject({
      taskKey: "OPA-1",
      assignedTeamId: null,
    });

    const counted = await file(token, body);
    expect(counted.status).toBe(200);
    expect(bugReportDeduplicatedSchema.parse(await counted.json())).toMatchObject({
      taskKey: "OPA-1",
      occurrences: 2,
    });

    const invalid = await file(token, {
      ...body,
      evidence: { http: { method: "POST", path: "/api/orders", status: 600 } },
    });
    expect(invalid.status).toBe(400);
    expect(problemSchema.parse(await invalid.json()).errors?.map((e) => e.path)).toEqual([
      "evidence.http.status",
    ]);

    const byPerson = await POST(
      apiRequest("POST", "/api/v1/projects/OPA/bug-reports", { cookie: admin, body }),
      project,
    );
    expect(byPerson.status).toBe(403);
  });
});
