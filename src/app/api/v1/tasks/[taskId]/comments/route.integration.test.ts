import { describe, expect, it, vi } from "vitest";

import { commentPageSchema, commentSchema } from "@/lib/schemas/comments";
import { problemSchema } from "@/lib/schemas/problem";
import { agentActor } from "@/server/auth/actor";
import {
  apiRequest,
  bearerRequest,
  createTestAccount,
  createTestAgent,
  createTestToken,
  signInCookie,
} from "@/server/auth/testing";
import { createComment } from "@/server/services/comments";

import { POST as createTask } from "../../../projects/[projectId]/tasks/route";
import { POST as createProject } from "../../../projects/route";
import { GET, POST } from "./route";

const project = { params: Promise.resolve({ projectId: "OPA" }) };

function task(taskId: string) {
  return { params: Promise.resolve({ taskId }) };
}

async function cookieFor(role: "viewer" | "member" | "manager") {
  await createTestAccount({ name: role, email: `${role}@example.com`, role });
  return signInCookie(`${role}@example.com`);
}

async function setup() {
  const manager = await cookieFor("manager");
  const member = await cookieFor("member");
  const viewer = await cookieFor("viewer");
  await createProject(
    apiRequest("POST", "/api/v1/projects", { cookie: manager, body: { key: "OPA", name: "O" } }),
    undefined,
  );
  await createTask(
    apiRequest("POST", "/api/v1/projects/OPA/tasks", { cookie: member, body: { title: "A" } }),
    project,
  );
  return { manager, member, viewer };
}

const path = "/api/v1/tasks/OPA-1/comments";

describe("task comment endpoints", () => {
  it("creates a comment with 201 and lists it with 200, for a Viewer too", async () => {
    const { member, viewer } = await setup();

    const created = await POST(
      apiRequest("POST", path, { cookie: member, body: { body: "Looks **good**" } }),
      task("OPA-1"),
    );
    expect(created.status).toBe(201);
    const comment = commentSchema.parse(await created.json());
    expect(comment).toMatchObject({ kind: "user", author: { name: "member", kind: "human" } });

    const listed = await GET(apiRequest("GET", path, { cookie: viewer }), task("OPA-1"));
    expect(listed.status).toBe(200);
    expect(commentPageSchema.parse(await listed.json())).toEqual({
      items: [comment],
      nextCursor: null,
    });
  });

  it("lists an agent's comment with the author's kind agent (WS-074)", async () => {
    const { viewer } = await setup();
    const scopes = ["projects:read", "tasks:read", "comments:write"] as const;
    const agent = await createTestAgent({ name: "QA Bot", scopes: [...scopes] });
    await createComment(
      agentActor({ accountId: agent.id, role: "qa_agent", scopes, projectIds: null }),
      "OPA-1",
      { body: "Found a bug" },
    );

    const listed = await GET(apiRequest("GET", path, { cookie: viewer }), task("OPA-1"));

    expect(listed.status).toBe(200);
    expect(commentPageSchema.parse(await listed.json()).items[0]?.author).toEqual({
      id: agent.id,
      name: "QA Bot",
      kind: "agent",
    });
  });

  it("answers 400, not 500, to a cursor whose time is no real date, and logs nothing (WS-051)", async () => {
    const { viewer } = await setup();
    const cursor = Buffer.from(
      JSON.stringify({
        t: "2026-02-30T10:00:00.000000Z",
        i: "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f",
      }),
    ).toString("base64url");
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const response = await GET(
        apiRequest("GET", `${path}?cursor=${cursor}`, { cookie: viewer }),
        task("OPA-1"),
      );
      expect(response.status).toBe(400);
      expect(problemSchema.parse(await response.json()).errors).toEqual([
        { path: "cursor", message: "Invalid cursor." },
      ]);
      expect(logged).not.toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });

  it("answers 403 to a Viewer writing and 401 without a session", async () => {
    const { viewer } = await setup();

    const statuses = await Promise.all([
      POST(apiRequest("POST", path, { cookie: viewer, body: { body: "Hi" } }), task("OPA-1")),
      POST(apiRequest("POST", path, { body: { body: "Hi" } }), task("OPA-1")),
      GET(apiRequest("GET", path), task("OPA-1")),
    ]);

    expect(statuses.map((response) => response.status)).toEqual([403, 401, 401]);
  });

  it("answers 400, 404, 415 and a foreign Origin 403 with problem bodies", async () => {
    const { member } = await setup();

    const blank = await POST(
      apiRequest("POST", path, { cookie: member, body: { body: "  " } }),
      task("OPA-1"),
    );
    const withKind = await POST(
      apiRequest("POST", path, { cookie: member, body: { body: "Hi", kind: "system" } }),
      task("OPA-1"),
    );
    const unknown = await POST(
      apiRequest("POST", "/api/v1/tasks/OPA-9/comments", { cookie: member, body: { body: "Hi" } }),
      task("OPA-9"),
    );
    const badPath = await GET(
      apiRequest("GET", "/api/v1/tasks/nope/comments", { cookie: member }),
      task("nope"),
    );
    const notJson = await POST(
      apiRequest("POST", path, {
        cookie: member,
        headers: { "Content-Type": "text/plain" },
      }),
      task("OPA-1"),
    );
    const foreign = await POST(
      apiRequest("POST", path, {
        cookie: member,
        body: { body: "Hi" },
        headers: { Origin: "https://evil.example" },
      }),
      task("OPA-1"),
    );

    expect([blank, withKind, unknown, badPath, notJson, foreign].map((r) => r.status)).toEqual([
      400, 400, 404, 400, 415, 403,
    ]);
    for (const response of [blank, withKind, unknown, badPath, notJson, foreign]) {
      expect(response.headers.get("content-type")).toContain("application/problem+json");
      problemSchema.parse(await response.json());
    }
  });
});

describe("a comment made with an agent's token (WS-078)", () => {
  it("is attributed to the agent", async () => {
    await setup();
    const agent = await createTestAgent({
      name: "Flow bot",
      scopes: ["projects:read", "tasks:read", "comments:write"],
    });
    const { token } = await createTestToken(agent.id);

    const response = await POST(
      bearerRequest("/api/v1/tasks/OPA-1/comments", token, {
        method: "POST",
        body: JSON.stringify({ body: "Seen by the bot" }),
      }),
      task("OPA-1"),
    );

    expect(response.status).toBe(201);
    const comment = commentSchema.parse(await response.json());
    expect(comment.author).toMatchObject({ id: agent.id, name: "Flow bot", kind: "agent" });
  });
});
