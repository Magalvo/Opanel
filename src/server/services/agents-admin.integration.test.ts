// The Admin API's services for agents and their tokens (WS-075 section 4).
import { describe, expect, it } from "vitest";

import { authenticate } from "@/server/auth/authenticate";
import { bearerRequest, createTestAccount, testActor } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { projects } from "@/server/db/schema";
import { ApiError } from "@/server/http/errors";

import {
  createAgent,
  createApiToken,
  getAgent,
  listAgents,
  listApiTokens,
  revokeApiToken,
  updateAgent,
} from "./agents";

async function admin() {
  return testActor(await createTestAccount({ email: "admin@example.com", role: "admin" }));
}

async function project(key: string): Promise<string> {
  const [row] = await getDb().insert(projects).values({ key, name: key }).returning();
  if (!row) throw new Error("no project");
  return row.id;
}

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("expected a failure");
}

async function auditRows() {
  return getDb().$client<
    { action: string; actor: string | null; entity: string; entity_id: string; data: unknown }[]
  >`select action, actor_account_id as actor, entity, entity_id, data
    from audit_log where action like 'agent.%' order by id`;
}

async function tokenWorks(token: string): Promise<boolean> {
  try {
    await authenticate(bearerRequest("/api/v1/me", token));
    return true;
  } catch {
    return false;
  }
}

describe("createAgent and getAgent (WS-075)", () => {
  it("creates an agent with its role's scopes by default, and audits it", async () => {
    const actor = await admin();

    const agent = await createAgent(actor, {
      name: "QA Bot",
      role: "qa_agent",
      projectIds: null,
    });

    expect(agent).toMatchObject({
      name: "QA Bot",
      description: null,
      role: "qa_agent",
      scopes: ["comments:write", "projects:read", "reports:write", "tasks:read"],
      projectIds: null,
      status: "active",
      lastSeenAt: null,
    });
    expect(await getAgent(actor, agent.id)).toEqual(agent);
    expect(await auditRows()).toEqual([
      {
        action: "agent.created",
        actor: actor.accountId,
        entity: "account",
        entity_id: agent.id,
        data: {
          role: "qa_agent",
          scopes: ["comments:write", "projects:read", "reports:write", "tasks:read"],
          projectIds: null,
        },
      },
    ]);
  });

  it("keeps a restriction to listed projects, and to none", async () => {
    const actor = await admin();
    const one = await project("ONE");

    const listed = await createAgent(actor, {
      name: "Listed",
      role: "worker_agent",
      scopes: ["tasks:read", "tasks:write"],
      projectIds: [one],
    });
    const none = await createAgent(actor, { name: "None", role: "qa_agent", projectIds: [] });

    expect((await getAgent(actor, listed.id)).projectIds).toEqual([one]);
    expect((await getAgent(actor, listed.id)).scopes).toEqual(["tasks:read", "tasks:write"]);
    expect((await getAgent(actor, none.id)).projectIds).toEqual([]);
  });

  it("refuses an unknown project with a field error, and a taken name in any case", async () => {
    const actor = await admin();
    await createAgent(actor, { name: "Bot", role: "qa_agent", projectIds: null });

    const unknown = await failure(
      createAgent(actor, {
        name: "Other",
        role: "qa_agent",
        projectIds: ["7c1f0e9e-2c39-4c1e-9b8e-2b6f4f1c5a01"],
      }),
    );
    expect(unknown.status).toBe(400);
    expect(unknown.errors?.map((error) => error.path)).toEqual(["projectIds"]);

    const taken = await failure(
      createAgent(actor, { name: "BOT", role: "qa_agent", projectIds: null }),
    );
    expect(taken.code).toBe("agent_name_taken");
  });

  it("is for agents:manage only, and a human's id is not an agent", async () => {
    const manager = testActor(await createTestAccount({ role: "manager" }));
    expect(
      (await failure(createAgent(manager, { name: "X", role: "qa_agent", projectIds: null })))
        .status,
    ).toBe(403);

    const actor = await admin();
    expect((await failure(getAgent(actor, actor.accountId))).status).toBe(404);
  });

  it("lists agents by name, a page at a time", async () => {
    const actor = await admin();
    for (const name of ["charlie", "Alpha", "bravo"]) {
      await createAgent(actor, { name, role: "qa_agent", projectIds: null });
    }

    const first = await listAgents(actor, { limit: 2 });
    const second = await listAgents(actor, { limit: 2, cursor: first.nextCursor ?? "" });

    expect(first.items.map((agent) => agent.name)).toEqual(["Alpha", "bravo"]);
    expect(second.items.map((agent) => agent.name)).toEqual(["charlie"]);
    expect(second.nextCursor).toBeNull();
  });
});

describe("updateAgent (WS-075)", () => {
  it("renames, changes the role keeping the scopes it allows, and replaces projects", async () => {
    const actor = await admin();
    const one = await project("ONE");
    const agent = await createAgent(actor, {
      name: "Worker",
      role: "worker_agent",
      scopes: ["tasks:read", "tasks:write"],
      projectIds: null,
    });

    const changed = await updateAgent(actor, agent.id, {
      name: "Reader",
      role: "qa_agent",
      projectIds: [one],
    });

    expect(changed).toMatchObject({
      name: "Reader",
      role: "qa_agent",
      scopes: ["tasks:read"],
      projectIds: [one],
    });
    const rows = await auditRows();
    expect(rows.at(-1)).toMatchObject({
      action: "agent.updated",
      actor: actor.accountId,
      data: { fields: ["name", "role", "scopes", "projectIds"] },
    });
  });

  it("refuses scopes outside the stored role", async () => {
    const actor = await admin();
    const agent = await createAgent(actor, { name: "QA", role: "qa_agent", projectIds: null });

    const error = await failure(updateAgent(actor, agent.id, { scopes: ["tasks:write"] }));
    expect(error.status).toBe(400);
    expect(error.errors?.map((field) => field.path)).toEqual(["scopes"]);
  });

  it("disables and re-enables an agent, and its token follows at once", async () => {
    const actor = await admin();
    const agent = await createAgent(actor, { name: "QA", role: "qa_agent", projectIds: null });
    const { token } = await createApiToken(actor, agent.id, { name: "CI", expiresInDays: 90 });

    expect((await updateAgent(actor, agent.id, { active: false })).status).toBe("disabled");
    expect(await tokenWorks(token)).toBe(false);
    expect((await updateAgent(actor, agent.id, { active: true })).status).toBe("active");
    expect(await tokenWorks(token)).toBe(true);

    expect((await auditRows()).map((row) => row.action).slice(-2)).toEqual([
      "agent.disabled",
      "agent.reenabled",
    ]);
  });

  it("writes nothing when nothing changes", async () => {
    const actor = await admin();
    const agent = await createAgent(actor, { name: "QA", role: "qa_agent", projectIds: null });
    const before = (await auditRows()).length;

    await updateAgent(actor, agent.id, { name: "QA", active: true });

    expect(await auditRows()).toHaveLength(before);
  });
});

describe("createApiToken, listApiTokens and revokeApiToken (WS-075)", () => {
  it("creates a working token, 90 days by default or with no expiry", async () => {
    const actor = await admin();
    const agent = await createAgent(actor, { name: "QA", role: "qa_agent", projectIds: null });

    const ninety = await createApiToken(actor, agent.id, { name: "CI", expiresInDays: 90 });
    const forever = await createApiToken(actor, agent.id, { name: "Lab", expiresInDays: null });

    expect(ninety.token).toMatch(/^opk_[a-z2-7]{12}_[0-9a-f]{64}$/);
    expect(await tokenWorks(ninety.token)).toBe(true);
    const days =
      (Date.parse(ninety.apiToken.expiresAt ?? "") - Date.parse(ninety.apiToken.createdAt)) /
      86_400_000;
    expect(Math.round(days)).toBe(90);
    expect(forever.apiToken.expiresAt).toBeNull();
    expect(ninety.apiToken.status).toBe("active");

    const [created] = (await auditRows()).filter((row) => row.action === "agent.token_created");
    expect(created).toMatchObject({
      actor: actor.accountId,
      entity: "api_token",
      entity_id: ninety.apiToken.id,
      data: { agentId: agent.id, name: "CI" },
    });
  });

  it("refuses an eleventh usable token, but not when one is revoked or expired", async () => {
    const actor = await admin();
    const agent = await createAgent(actor, { name: "QA", role: "qa_agent", projectIds: null });
    const made = [];
    for (let i = 0; i < 10; i += 1) {
      made.push(
        await createApiToken(actor, agent.id, { name: `T${String(i)}`, expiresInDays: 30 }),
      );
    }

    expect(
      (await failure(createApiToken(actor, agent.id, { name: "11", expiresInDays: 30 }))).code,
    ).toBe("too_many_tokens");

    await revokeApiToken(actor, agent.id, made[0]?.apiToken.id ?? "");
    await getDb().$client`update api_tokens set expires_at = now() - interval '1 second'
      where id = ${made[1]?.apiToken.id ?? ""}`;
    await createApiToken(actor, agent.id, { name: "11", expiresInDays: 30 });
    await createApiToken(actor, agent.id, { name: "12", expiresInDays: 30 });
    expect(
      (await failure(createApiToken(actor, agent.id, { name: "13", expiresInDays: 30 }))).code,
    ).toBe("too_many_tokens");
  });

  it("never goes above 10 under concurrent creates", async () => {
    const actor = await admin();
    const agent = await createAgent(actor, { name: "QA", role: "qa_agent", projectIds: null });
    for (let i = 0; i < 9; i += 1) {
      await createApiToken(actor, agent.id, { name: `T${String(i)}`, expiresInDays: 30 });
    }

    const results = await Promise.allSettled([
      createApiToken(actor, agent.id, { name: "A", expiresInDays: 30 }),
      createApiToken(actor, agent.id, { name: "B", expiresInDays: 30 }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await listApiTokens(actor, agent.id)).items).toHaveLength(10);
  });

  it("refuses a token to a disabled agent", async () => {
    const actor = await admin();
    const agent = await createAgent(actor, { name: "QA", role: "qa_agent", projectIds: null });
    await updateAgent(actor, agent.id, { active: false });

    expect(
      (await failure(createApiToken(actor, agent.id, { name: "CI", expiresInDays: 30 }))).code,
    ).toBe("agent_disabled");
  });

  it("lists tokens with their status and never their secret; revoking stops one at once", async () => {
    const actor = await admin();
    const agent = await createAgent(actor, { name: "QA", role: "qa_agent", projectIds: null });
    const active = await createApiToken(actor, agent.id, { name: "A", expiresInDays: 30 });
    const expired = await createApiToken(actor, agent.id, { name: "E", expiresInDays: 30 });
    const revoked = await createApiToken(actor, agent.id, { name: "R", expiresInDays: 30 });
    await getDb().$client`update api_tokens set expires_at = now() - interval '1 second'
      where id = ${expired.apiToken.id}`;

    await revokeApiToken(actor, agent.id, revoked.apiToken.id);
    await revokeApiToken(actor, agent.id, revoked.apiToken.id);

    const list = await listApiTokens(actor, agent.id);
    expect(Object.fromEntries(list.items.map((item) => [item.name, item.status]))).toEqual({
      A: "active",
      E: "expired",
      R: "revoked",
    });
    expect(list.nextCursor).toBeNull();
    for (const item of list.items) {
      expect(Object.keys(item).sort()).toEqual(
        ["createdAt", "expiresAt", "id", "lastUsedAt", "name", "revokedAt", "status"].sort(),
      );
    }
    expect(await tokenWorks(revoked.token)).toBe(false);
    expect(await tokenWorks(active.token)).toBe(true);
    expect((await auditRows()).filter((row) => row.action === "agent.token_revoked")).toHaveLength(
      1,
    );
  });

  it("answers 404 for another agent's token", async () => {
    const actor = await admin();
    const one = await createAgent(actor, { name: "One", role: "qa_agent", projectIds: null });
    const two = await createAgent(actor, { name: "Two", role: "qa_agent", projectIds: null });
    const token = await createApiToken(actor, one.id, { name: "CI", expiresInDays: 30 });

    expect((await failure(revokeApiToken(actor, two.id, token.apiToken.id))).status).toBe(404);
  });

  it("never writes the token, its secret or its hash to the audit log", async () => {
    const actor = await admin();
    const agent = await createAgent(actor, { name: "QA", role: "qa_agent", projectIds: null });
    const { token, apiToken } = await createApiToken(actor, agent.id, {
      name: "CI",
      expiresInDays: 30,
    });
    await revokeApiToken(actor, agent.id, apiToken.id);
    const [stored] = await getDb().$client<{ hash: string; public_id: string }[]>`
      select secret_hash as hash, public_id from api_tokens where id = ${apiToken.id}`;

    const audit = JSON.stringify(await auditRows());
    expect(audit).not.toContain(token.slice(17));
    expect(audit).not.toContain(stored?.hash ?? "missing");
    expect(audit).not.toContain(stored?.public_id ?? "missing");
  });
});
