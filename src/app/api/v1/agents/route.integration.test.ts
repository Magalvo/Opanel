// The Admin API for agents and tokens through its routes (WS-075 test 10).
import { describe, expect, it } from "vitest";

import { problemSchema } from "@/lib/schemas/problem";
import {
  apiRequest,
  bearerRequest,
  createTestAccount,
  createTestAgent,
  createTestToken,
  signInCookie,
} from "@/server/auth/testing";

import { GET as getOne, PATCH } from "./[agentId]/route";
import { DELETE as revokeToken } from "./[agentId]/tokens/[tokenId]/route";
import { GET as listTokens, POST as createToken } from "./[agentId]/tokens/route";
import { GET as list, POST as create } from "./route";

const UNKNOWN = "7c1f0e9e-2c39-4c1e-9b8e-2b6f4f1c5a01";

function agentContext(agentId: string) {
  return { params: Promise.resolve({ agentId }) };
}

function tokenContext(agentId: string, tokenId: string) {
  return { params: Promise.resolve({ agentId, tokenId }) };
}

async function signedIn(role: "admin" | "manager"): Promise<string> {
  await createTestAccount({ email: `${role}@example.com`, role });
  return signInCookie(`${role}@example.com`);
}

/** Every operation, as a session (`cookie`) or a token sends it. */
function calls(agentId: string, tokenId: string, auth: { cookie?: string; token?: string }) {
  const request = (method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown) =>
    auth.token === undefined
      ? apiRequest(method, path, {
          ...(auth.cookie === undefined ? {} : { cookie: auth.cookie }),
          ...(body === undefined ? {} : { body }),
        })
      : bearerRequest(path, auth.token, {
          method,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
  return [
    list(request("GET", "/api/v1/agents"), undefined),
    create(
      request("POST", "/api/v1/agents", { name: "X", role: "qa_agent", projectIds: null }),
      undefined,
    ),
    getOne(request("GET", `/api/v1/agents/${agentId}`), agentContext(agentId)),
    PATCH(request("PATCH", `/api/v1/agents/${agentId}`, { name: "Y" }), agentContext(agentId)),
    listTokens(request("GET", `/api/v1/agents/${agentId}/tokens`), agentContext(agentId)),
    createToken(
      request("POST", `/api/v1/agents/${agentId}/tokens`, { name: "CI" }),
      agentContext(agentId),
    ),
    revokeToken(
      request("DELETE", `/api/v1/agents/${agentId}/tokens/${tokenId}`),
      tokenContext(agentId, tokenId),
    ),
  ];
}

describe("the agents API needs agents:manage (WS-075)", () => {
  it("answers 403 to a Manager and to an agent token on every operation", async () => {
    const cookie = await signedIn("manager");
    const agent = await createTestAgent({
      role: "worker_agent",
      scopes: ["projects:read", "tasks:read", "tasks:write", "comments:write", "reports:write"],
    });
    const { token, id: tokenId } = await createTestToken(agent.id);

    for (const response of await Promise.all(calls(agent.id, tokenId, { cookie }))) {
      expect(response.status).toBe(403);
    }
    for (const response of await Promise.all(calls(agent.id, tokenId, { token }))) {
      expect(response.status).toBe(403);
    }
  });

  it("gives an Admin each documented status", async () => {
    const cookie = await signedIn("admin");

    const created = await create(
      apiRequest("POST", "/api/v1/agents", {
        cookie,
        body: { name: "QA Bot", role: "qa_agent", projectIds: null },
      }),
      undefined,
    );
    expect(created.status).toBe(201);
    const agent = (await created.json()) as { id: string };

    const listed = await list(apiRequest("GET", "/api/v1/agents", { cookie }), undefined);
    expect(listed.status).toBe(200);
    expect(((await listed.json()) as { items: unknown[] }).items).toHaveLength(1);

    expect(
      (
        await getOne(
          apiRequest("GET", `/api/v1/agents/${agent.id}`, { cookie }),
          agentContext(agent.id),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await PATCH(
          apiRequest("PATCH", `/api/v1/agents/${agent.id}`, { cookie, body: { name: "QA" } }),
          agentContext(agent.id),
        )
      ).status,
    ).toBe(200);

    const madeToken = await createToken(
      apiRequest("POST", `/api/v1/agents/${agent.id}/tokens`, { cookie, body: { name: "CI" } }),
      agentContext(agent.id),
    );
    expect(madeToken.status).toBe(201);
    const { apiToken } = (await madeToken.json()) as { apiToken: { id: string } };

    expect(
      (
        await listTokens(
          apiRequest("GET", `/api/v1/agents/${agent.id}/tokens`, { cookie }),
          agentContext(agent.id),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await revokeToken(
          apiRequest("DELETE", `/api/v1/agents/${agent.id}/tokens/${apiToken.id}`, { cookie }),
          tokenContext(agent.id, apiToken.id),
        )
      ).status,
    ).toBe(204);
  });

  it("answers 400 to a path that is not a uuid and 404 to an unknown agent", async () => {
    const cookie = await signedIn("admin");

    const bad = await getOne(
      apiRequest("GET", "/api/v1/agents/nope", { cookie }),
      agentContext("nope"),
    );
    const unknown = await getOne(
      apiRequest("GET", `/api/v1/agents/${UNKNOWN}`, { cookie }),
      agentContext(UNKNOWN),
    );

    expect(bad.status).toBe(400);
    expect(unknown.status).toBe(404);
    expect(problemSchema.parse(await unknown.json()).code).toBe("not_found");
  });
});
