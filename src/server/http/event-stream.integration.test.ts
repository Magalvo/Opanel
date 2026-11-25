import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Authenticated } from "@/server/auth/authenticate";
import {
  apiRequest,
  bearerRequest,
  createTestAccount,
  createTestAgent,
  createTestToken,
  setDisabled,
  signInCookie,
  testActor,
} from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { agentProjects, apiTokens, sessions } from "@/server/db/schema";
import { closeEventHub, type EventHub } from "@/server/services/event-hub";
import { publishEvent } from "@/server/services/events";
import { createProject } from "@/server/services/projects";

import { openEventStream } from "./event-stream";
import { type FrameReader, readFrames } from "./event-stream-testing";

const open: FrameReader[] = [];

afterEach(async () => {
  await Promise.all(open.splice(0).map((reader) => reader.cancel()));
  await closeEventHub();
});

async function setup() {
  const manager = await createTestAccount({ email: "manager@example.com", role: "manager" });
  const member = await createTestAccount({ email: "mia@example.com", role: "member" });
  const project = await createProject(testActor(manager), { key: "ONE", name: "One" });
  const cookie = await signInCookie("mia@example.com");
  const request = apiRequest("GET", "/api/v1/projects/ONE/events", { cookie });
  return { member, project, request };
}

async function stream(options: Parameters<typeof openEventStream>[0]): Promise<FrameReader> {
  const reader = readFrames(await openEventStream(options));
  open.push(reader);
  return reader;
}

describe("openEventStream (WS-047)", () => {
  it("sends heartbeats, and ends at the next one after the session is revoked", async () => {
    const { member, project, request } = await setup();
    const reader = await stream({
      request,
      projectId: project.id,
      account: member.id,
      heartbeatMs: 50,
    });
    await reader.next();

    expect(await reader.next()).toMatchObject({ comments: ["heartbeat"] });
    await getDb().delete(sessions).where(eq(sessions.accountId, member.id));

    await reader.closed();
  });

  it("ends at the next heartbeat after the account is deactivated", async () => {
    const { member, project, request } = await setup();
    const reader = await stream({
      request,
      projectId: project.id,
      account: member.id,
      heartbeatMs: 50,
    });

    await setDisabled(member.id, true);

    await reader.closed();
  });

  it("ends at the next heartbeat when the account no longer holds tasks:read", async () => {
    const { member, project, request } = await setup();
    const withoutRead = (): Promise<Authenticated> =>
      Promise.resolve({
        via: "session",
        actor: {
          kind: "human",
          accountId: member.id,
          role: "viewer",
          permissions: new Set(),
          projectIds: null,
        },
        account: member,
        sessionId: "none",
        headers: new Headers(),
      });

    const reader = await stream({
      request,
      projectId: project.id,
      account: member.id,
      heartbeatMs: 50,
      authenticate: withoutRead,
    });

    await reader.closed();
  });

  it("ends when the hub resets, and frees its place", async () => {
    const { member, project, request } = await setup();
    const reader = await stream({
      request,
      projectId: project.id,
      account: member.id,
      maxStreamsPerAccount: 1,
    });

    await getDb().execute(
      sql`select pg_terminate_backend(pid) from pg_stat_activity
          where application_name = 'opanel-events' and datname = current_database()`,
    );

    await reader.closed(10_000);
    await stream({ request, projectId: project.id, account: member.id, maxStreamsPerAccount: 1 });
  });

  it("closes a stream nobody reads once 64 KiB are waiting, and frees its place", async () => {
    const { member, project, request } = await setup();
    const reader = await stream({
      request,
      projectId: project.id,
      account: member.id,
      maxStreamsPerAccount: 1,
    });

    await getDb().transaction(async (tx) => {
      for (let i = 1; i <= 400; i++) {
        await publishEvent(tx, {
          type: "task.updated",
          entity: "task",
          projectId: project.id,
          entityId: project.id,
          version: i,
          actorAccountId: member.id,
        });
      }
    });

    // Not read until it has been dropped: reading would drain the queue it is meant to fill.
    // The notifications arrive after the commit, so wait for the place to come back.
    await vi.waitFor(
      async () => {
        await stream({
          request,
          projectId: project.id,
          account: member.id,
          maxStreamsPerAccount: 1,
        });
      },
      { timeout: 10_000, interval: 50 },
    );
    await reader.closed();
  });

  it("gives its place back when the hub cannot subscribe", async () => {
    const { member, project, request } = await setup();
    const down: EventHub = { subscribe: () => Promise.reject(new Error("database down")) };

    await expect(
      openEventStream({
        request,
        projectId: project.id,
        account: member.id,
        hub: down,
        maxStreamsPerAccount: 1,
      }),
    ).rejects.toThrow("database down");
    await stream({ request, projectId: project.id, account: member.id, maxStreamsPerAccount: 1 });
  });
});

describe("openEventStream and session renewal (WS-124)", () => {
  /** A stream on a session past its one-day renewal age: five of its seven days left. */
  async function agedStream() {
    const { member, project, request } = await setup();
    const expiresAt = new Date(Date.now() + 5 * 86_400_000);
    await getDb().update(sessions).set({ expiresAt }).where(eq(sessions.accountId, member.id));
    const reader = await stream({
      request,
      projectId: project.id,
      account: member.id,
      heartbeatMs: 50,
    });
    await reader.next();
    return { member, reader, expiresAt };
  }

  it("extends no session over its heartbeats", async () => {
    const { member, reader, expiresAt } = await agedStream();

    expect(await reader.next()).toMatchObject({ comments: ["heartbeat"] });
    expect(await reader.next()).toMatchObject({ comments: ["heartbeat"] });

    const [row] = await getDb().select().from(sessions).where(eq(sessions.accountId, member.id));
    expect(row?.expiresAt.getTime()).toBe(expiresAt.getTime());
  });

  it("ends at the next heartbeat once the session has expired", async () => {
    const { member, reader } = await agedStream();
    expect(await reader.next()).toMatchObject({ comments: ["heartbeat"] });

    await getDb()
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.accountId, member.id));

    await reader.closed();
  });

  it("ends at the next heartbeat once the session is revoked", async () => {
    const { member, reader } = await agedStream();
    expect(await reader.next()).toMatchObject({ comments: ["heartbeat"] });

    await getDb().delete(sessions).where(eq(sessions.accountId, member.id));

    await reader.closed();
  });
});

describe("openEventStream with an API token (WS-072)", () => {
  async function agentStream() {
    const manager = await createTestAccount({ email: "manager@example.com", role: "manager" });
    const project = await createProject(testActor(manager), { key: "ONE", name: "One" });
    const agent = await createTestAgent({ scopes: ["tasks:read"] });
    const { token, id } = await createTestToken(agent.id);
    const reader = await stream({
      request: bearerRequest("/api/v1/projects/ONE/events", token),
      projectId: project.id,
      account: agent.id,
      heartbeatMs: 50,
    });
    await reader.next();
    return { agent, tokenId: id, reader };
  }

  it("sends heartbeats, and ends at the next one after the token is revoked", async () => {
    const { tokenId, reader } = await agentStream();

    expect(await reader.next()).toMatchObject({ comments: ["heartbeat"] });
    await getDb().update(apiTokens).set({ revokedAt: new Date() }).where(eq(apiTokens.id, tokenId));

    await reader.closed();
  });

  it("ends at the next heartbeat after the agent is disabled", async () => {
    const { agent, reader } = await agentStream();

    expect(await reader.next()).toMatchObject({ comments: ["heartbeat"] });
    await setDisabled(agent.id, true);

    await reader.closed();
  });

  it("ends at the next heartbeat when the agent no longer reaches the project (WS-073)", async () => {
    const manager = await createTestAccount({ email: "manager@example.com", role: "manager" });
    const project = await createProject(testActor(manager), { key: "ONE", name: "One" });
    const agent = await createTestAgent({ scopes: ["tasks:read"], projectIds: [project.id] });
    const { token } = await createTestToken(agent.id);
    const request = bearerRequest("/api/v1/projects/ONE/events", token);
    const reader = await stream({
      request,
      projectId: project.id,
      account: agent.id,
      heartbeatMs: 50,
      maxStreamsPerAccount: 1,
    });
    await reader.next();
    expect(await reader.next()).toMatchObject({ comments: ["heartbeat"] });

    await getDb().delete(agentProjects).where(eq(agentProjects.accountId, agent.id));

    await reader.closed();
    await stream({ request, projectId: project.id, account: agent.id, maxStreamsPerAccount: 1 });
  });
});
