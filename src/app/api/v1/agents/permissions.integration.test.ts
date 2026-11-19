// WT-05's exit criterion: no agent can hold a `*:manage` or delete permission. The database
// refuses it (WS-071); this tries every such permission through the API (WS-078).
import { describe, expect, it } from "vitest";

import { AGENT_SCOPES, PERMISSIONS } from "@/lib/schemas/permissions";
import { problemSchema } from "@/lib/schemas/problem";
import { apiRequest, createTestAccount, signInCookie } from "@/server/auth/testing";

import { PATCH } from "./[agentId]/route";
import { POST } from "./route";

const NOT_FOR_AGENTS = PERMISSIONS.filter(
  (permission) => !(AGENT_SCOPES as readonly string[]).includes(permission),
);

/** The fields named, with an array element's index dropped (`scopes.0` is `scopes`). */
async function fieldsOf(response: Response): Promise<string[]> {
  return (problemSchema.parse(await response.json()).errors ?? []).map(
    (error) => error.path.split(".")[0] ?? "",
  );
}

describe("no agent can be given a permission outside the agent scopes (WS-078)", () => {
  it("covers every manage and delete permission of the catalogue", () => {
    expect(NOT_FOR_AGENTS).toEqual(
      expect.arrayContaining(["agents:manage", "accounts:manage", "tasks:delete_any"]),
    );
    for (const permission of PERMISSIONS) {
      if (permission.endsWith(":manage") || permission.startsWith("tasks:delete")) {
        expect(NOT_FOR_AGENTS).toContain(permission);
      }
    }
  });

  it("refuses each one on create and on change, with the field error scopes", async () => {
    await createTestAccount({ email: "admin@example.com", role: "admin" });
    const cookie = await signInCookie("admin@example.com");
    const created = await POST(
      apiRequest("POST", "/api/v1/agents", {
        cookie,
        body: { name: "Worker", role: "worker_agent", projectIds: null },
      }),
      undefined,
    );
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    for (const permission of NOT_FOR_AGENTS) {
      const onCreate = await POST(
        apiRequest("POST", "/api/v1/agents", {
          cookie,
          body: {
            name: `Bot ${permission}`,
            role: "worker_agent",
            scopes: [permission],
            projectIds: null,
          },
        }),
        undefined,
      );
      expect(onCreate.status, permission).toBe(400);
      expect(await fieldsOf(onCreate), permission).toContain("scopes");

      const onChange = await PATCH(
        apiRequest("PATCH", `/api/v1/agents/${id}`, { cookie, body: { scopes: [permission] } }),
        { params: Promise.resolve({ agentId: id }) },
      );
      expect(onChange.status, permission).toBe(400);
      expect(await fieldsOf(onChange), permission).toContain("scopes");
    }
  });
});
