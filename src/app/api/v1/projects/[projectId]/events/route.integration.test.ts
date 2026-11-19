import { afterEach, describe, expect, it } from "vitest";

import { projectEventSchema } from "@/lib/schemas/events";
import { problemSchema } from "@/lib/schemas/problem";
import { apiRequest, createTestAccount, signInCookie, testActor } from "@/server/auth/testing";
import { type FrameReader, readFrames } from "@/server/http/event-stream-testing";
import { closeEventHub } from "@/server/services/event-hub";
import { createProject } from "@/server/services/projects";
import { createTask } from "@/server/services/tasks";

import { GET } from "./route";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const open: FrameReader[] = [];

afterEach(async () => {
  await Promise.all(open.splice(0).map((reader) => reader.cancel()));
  await closeEventHub();
});

async function setup() {
  const manager = await createTestAccount({ email: "manager@example.com", role: "manager" });
  const member = await createTestAccount({ email: "mia@example.com", role: "member" });
  const viewer = await createTestAccount({ email: "vic@example.com", role: "viewer" });
  const managerActor = testActor(manager);
  const one = await createProject(managerActor, { key: "ONE", name: "One" });
  const two = await createProject(managerActor, { key: "TWO", name: "Two" });
  return { managerActor, member, viewer, one, two };
}

function streamRequest(project: string, cookie?: string, signal?: AbortSignal): Request {
  const request = apiRequest("GET", `/api/v1/projects/${project}/events`, {
    ...(cookie === undefined ? {} : { cookie }),
  });
  return signal ? new Request(request, { signal }) : request;
}

async function openStream(project: string, cookie: string, signal?: AbortSignal) {
  const response = await GET(streamRequest(project, cookie, signal), {
    params: Promise.resolve({ projectId: project }),
  });
  if (response.status === 200) open.push(readFrames(response));
  return response;
}

function lastReader(): FrameReader {
  const reader = open.at(-1);
  if (!reader) throw new Error("no stream is open");
  return reader;
}

describe("GET /api/v1/projects/{projectId}/events (WS-047)", () => {
  it("answers 401 without a session and 404 for an unknown project", async () => {
    await setup();
    const cookie = await signInCookie("mia@example.com");

    const anonymous = await GET(streamRequest("ONE"), {
      params: Promise.resolve({ projectId: "ONE" }),
    });
    const unknown = await openStream("NOPE", cookie);

    expect(anonymous.status).toBe(401);
    expect(unknown.status).toBe(404);
    expect(problemSchema.parse(await unknown.json()).code).toBe("not_found");
  });

  it("answers 400 to a project reference that is neither a uuid nor a key (WS-083)", async () => {
    await setup();
    const cookie = await signInCookie("mia@example.com");

    const response = await GET(streamRequest("not%20a%20key", cookie), {
      params: Promise.resolve({ projectId: "not a key" }),
    });

    expect(response.status).toBe(400);
    expect(problemSchema.parse(await response.json()).code).toBe("invalid_request");
  });

  it("opens for a Viewer, as text/event-stream that nothing may compress or buffer", async () => {
    await setup();
    const cookie = await signInCookie("vic@example.com");

    const response = await openStream("ONE", cookie);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("no-store, no-transform");
    expect(response.headers.get("X-Accel-Buffering")).toBe("no");
    expect(response.headers.get("X-Request-Id")).toMatch(UUID);
    expect(await lastReader().next()).toMatchObject({ retry: "3000", comments: ["connected"] });
  });

  it("delivers an event committed after the response, and none of another project", async () => {
    const { member, one } = await setup();
    const cookie = await signInCookie("mia@example.com");
    await openStream("ONE", cookie);
    const reader = lastReader();

    await createTask(testActor(member), "TWO", { title: "Elsewhere" });
    const task = await createTask(testActor(member), "ONE", { title: "Here" });

    const frame = await reader.nextEvent();
    expect(frame).toMatchObject({ event: "task.created" });
    const event = projectEventSchema.parse(
      JSON.parse(frame === "closed" ? "" : (frame.data ?? "")),
    );
    expect(event).toMatchObject({
      projectId: one.id,
      entityId: task.id,
      actorAccountId: member.id,
    });
  });

  it("refuses an account's 11th stream with 429, and a stream that ends frees its place", async () => {
    await setup();
    const mia = await signInCookie("mia@example.com");
    const vic = await signInCookie("vic@example.com");
    const aborts = Array.from({ length: 10 }, () => new AbortController());
    for (const abort of aborts) {
      expect((await openStream("ONE", mia, abort.signal)).status).toBe(200);
    }

    const eleventh = await openStream("ONE", mia);
    expect(eleventh.status).toBe(429);
    expect(eleventh.headers.get("Retry-After")).toBe("30");
    expect(problemSchema.parse(await eleventh.json()).code).toBe("too_many_streams");
    expect((await openStream("ONE", vic)).status).toBe(200);

    await open[0]?.cancel();
    expect((await openStream("ONE", mia)).status).toBe(200);
    expect((await openStream("TWO", mia)).status).toBe(429);

    aborts[1]?.abort();
    expect((await openStream("TWO", mia)).status).toBe(200);
  });
});
