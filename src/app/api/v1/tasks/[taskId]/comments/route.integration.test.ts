import { describe, expect, it } from "vitest";

import { commentPageSchema, commentSchema } from "@/lib/schemas/comments";
import { problemSchema } from "@/lib/schemas/problem";
import { apiRequest, createTestAccount, signInCookie } from "@/server/auth/testing";

import { POST as createTask } from "../../../projects/[projectId]/tasks/route";
import { POST as createProject } from "../../../projects/route";
import { GET, POST } from "./route";

const task = { params: Promise.resolve({ taskId: "OPA-1" }) };

async function cookieFor(role: "viewer" | "member" | "manager") {
  await createTestAccount({ name: role, email: `${role}@example.com`, role });
  return signInCookie(`${role}@example.com`);
}

async function seed() {
  const manager = await cookieFor("manager");
  await createProject(
    apiRequest("POST", "/api/v1/projects", { cookie: manager, body: { key: "OPA", name: "O" } }),
    undefined,
  );
  const member = await cookieFor("member");
  await createTask(
    apiRequest("POST", "/api/v1/projects/OPA/tasks", { cookie: member, body: { title: "T" } }),
    { params: Promise.resolve({ projectId: "OPA" }) },
  );
  return { manager, member, viewer: await cookieFor("viewer") };
}

describe("comment endpoints", () => {
  it("create answers 201 with the comment, list returns it", async () => {
    const { member } = await seed();

    const created = await POST(
      apiRequest("POST", "/api/v1/tasks/OPA-1/comments", {
        cookie: member,
        body: { body: "Looks **good**" },
      }),
      task,
    );
    expect(created.status).toBe(201);
    expect(created.headers.get("Cache-Control")).toBe("no-store");
    expect(commentSchema.parse(await created.json())).toMatchObject({
      body: "Looks **good**",
      kind: "user",
      author: { name: "member" },
    });

    const listed = await GET(
      apiRequest("GET", "/api/v1/tasks/OPA-1/comments", { cookie: member }),
      task,
    );
    expect(listed.status).toBe(200);
    expect(commentPageSchema.parse(await listed.json()).items).toHaveLength(1);
  });

  it("lets a Viewer read but not write, and answers 401 without a session", async () => {
    const { member, viewer } = await seed();
    await POST(
      apiRequest("POST", "/api/v1/tasks/OPA-1/comments", { cookie: member, body: { body: "Hi" } }),
      task,
    );

    const read = await GET(
      apiRequest("GET", "/api/v1/tasks/OPA-1/comments", { cookie: viewer }),
      task,
    );
    const write = await POST(
      apiRequest("POST", "/api/v1/tasks/OPA-1/comments", { cookie: viewer, body: { body: "No" } }),
      task,
    );
    const anonymous = await GET(apiRequest("GET", "/api/v1/tasks/OPA-1/comments"), task);

    expect(read.status).toBe(200);
    expect(write.status).toBe(403);
    expect(anonymous.status).toBe(401);
  });

  it("answers 400 without echoing a blank body, 415 for non-JSON, 404 for an unknown task", async () => {
    const { member } = await seed();

    const blank = await POST(
      apiRequest("POST", "/api/v1/tasks/OPA-1/comments", { cookie: member, body: { body: "   " } }),
      task,
    );
    expect(blank.status).toBe(400);
    const problem = problemSchema.parse(await blank.json());
    expect(problem.errors?.map((error) => error.path)).toEqual(["body"]);

    const notJson = await POST(
      apiRequest("POST", "/api/v1/tasks/OPA-1/comments", {
        cookie: member,
        headers: { "Content-Type": "text/plain" },
      }),
      task,
    );
    expect(notJson.status).toBe(415);

    const missing = await GET(
      apiRequest("GET", "/api/v1/tasks/OPA-9/comments", { cookie: member }),
      { params: Promise.resolve({ taskId: "OPA-9" }) },
    );
    expect(missing.status).toBe(404);
    expect(problemSchema.parse(await missing.json()).code).toBe("not_found");
  });
});
