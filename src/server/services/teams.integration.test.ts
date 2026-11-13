import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createTestAccount, failAuditFor, testActor } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { accounts, auditLog, teamMembers, teams } from "@/server/db/schema";
import { ApiError } from "@/server/http/errors";

import {
  addTeamMember,
  createTeam,
  deleteTeam,
  getTeam,
  listTeams,
  removeTeamMember,
  renameTeam,
} from "./teams";

const UNKNOWN = "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f";

async function manager() {
  const account = await createTestAccount({
    name: "Manager",
    email: "manager@example.com",
    role: "manager",
  });
  return { account, actor: testActor(account) };
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

async function audits() {
  return getDb().select().from(auditLog).orderBy(auditLog.id);
}

describe("createTeam", () => {
  it("creates the team and records team.created with its actor", async () => {
    const { account, actor } = await manager();

    const team = await createTeam(actor, { name: "Frontend" });

    expect(team).toMatchObject({ name: "Frontend", members: [] });
    const [entry] = await audits();
    expect(entry).toMatchObject({
      actorAccountId: account.id,
      action: "team.created",
      entity: "team",
      entityId: team.id,
      data: { name: "Frontend" },
    });
  });

  it("refuses a name that differs only by case with team_name_taken", async () => {
    const { actor } = await manager();
    await createTeam(actor, { name: "Frontend" });

    const error = await failure(createTeam(actor, { name: "frontend" }));

    expect(error.status).toBe(409);
    expect(error.code).toBe("team_name_taken");
    expect(await getDb().select().from(teams)).toHaveLength(1);
  });

  it("gives one success and one team_name_taken to two concurrent creations", async () => {
    const { actor } = await manager();

    const results = await Promise.allSettled([
      createTeam(actor, { name: "API" }),
      createTeam(actor, { name: "api" }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toMatchObject({
      code: "team_name_taken",
    });
  });

  it("needs teams:manage", async () => {
    const member = await createTestAccount({ email: "member@example.com", role: "member" });

    const error = await failure(createTeam(testActor(member), { name: "X" }));

    expect(error.status).toBe(403);
  });
});

describe("renameTeam", () => {
  it("renames and records the old and new names", async () => {
    const { actor } = await manager();
    const team = await createTeam(actor, { name: "Front" });

    const renamed = await renameTeam(actor, team.id, { name: "Frontend" });

    expect(renamed.name).toBe("Frontend");
    expect((await audits()).at(-1)).toMatchObject({
      action: "team.renamed",
      entityId: team.id,
      data: { from: "Front", to: "Frontend" },
    });
  });

  it("writes no audit entry when the name does not change", async () => {
    const { actor } = await manager();
    const team = await createTeam(actor, { name: "Front" });

    await renameTeam(actor, team.id, { name: "Front" });

    expect(await audits()).toHaveLength(1);
  });

  it("refuses a taken name and an unknown team", async () => {
    const { actor } = await manager();
    await createTeam(actor, { name: "API" });
    const team = await createTeam(actor, { name: "Backend" });

    expect((await failure(renameTeam(actor, team.id, { name: "api" }))).code).toBe(
      "team_name_taken",
    );
    expect((await failure(renameTeam(actor, UNKNOWN, { name: "X" }))).status).toBe(404);
  });
});

describe("team membership", () => {
  it("adds a person with team.member_added, and adding again changes nothing", async () => {
    const { actor } = await manager();
    const team = await createTeam(actor, { name: "Frontend" });
    const ada = await createTestAccount({ name: "Ada", email: "ada@example.com" });

    const after = await addTeamMember(actor, team.id, { accountId: ada.id });
    await addTeamMember(actor, team.id, { accountId: ada.id });

    expect(after.members).toEqual([{ id: ada.id, name: "Ada", active: true }]);
    expect((await audits()).map((entry) => entry.action)).toEqual([
      "team.created",
      "team.member_added",
    ]);
    expect((await audits()).at(-1)?.data).toEqual({ accountId: ada.id });
  });

  it("refuses an unknown account, an agent or an invited account with 400 on accountId", async () => {
    const { actor } = await manager();
    const team = await createTeam(actor, { name: "Frontend" });
    const [agentRow] = await getDb()
      .insert(accounts)
      .values({ kind: "agent", name: "Bot", role: "qa_agent" })
      .returning();
    const [invitedRow] = await getDb()
      .insert(accounts)
      .values({ kind: "human", name: "Ivy", email: "ivy@example.com", role: "member" })
      .returning();

    for (const accountId of [UNKNOWN, agentRow?.id ?? "", invitedRow?.id ?? ""]) {
      const error = await failure(addTeamMember(actor, team.id, { accountId }));
      expect(error.status).toBe(400);
      expect(error.errors).toEqual([{ path: "accountId", message: expect.any(String) }]);
    }
  });

  it("refuses a deactivated person with account_inactive, and an unknown team with 404", async () => {
    const { actor } = await manager();
    const team = await createTeam(actor, { name: "Frontend" });
    const gone = await createTestAccount({ email: "gone@example.com", disabled: true });

    expect((await failure(addTeamMember(actor, team.id, { accountId: gone.id }))).code).toBe(
      "account_inactive",
    );
    expect((await failure(addTeamMember(actor, UNKNOWN, { accountId: gone.id }))).status).toBe(404);
  });

  it("removes a member with team.member_removed; a non-member is 404", async () => {
    const { actor } = await manager();
    const team = await createTeam(actor, { name: "Frontend" });
    const ada = await createTestAccount({ name: "Ada", email: "ada@example.com" });
    await addTeamMember(actor, team.id, { accountId: ada.id });

    await removeTeamMember(actor, team.id, ada.id);

    expect((await getTeam(actor, team.id)).members).toEqual([]);
    expect((await audits()).at(-1)).toMatchObject({
      action: "team.member_removed",
      data: { accountId: ada.id },
    });
    expect((await failure(removeTeamMember(actor, team.id, ada.id))).status).toBe(404);
  });

  it("keeps a member who is deactivated later, shown as inactive, with members ordered by name", async () => {
    const { actor } = await manager();
    const team = await createTeam(actor, { name: "Frontend" });
    const zoe = await createTestAccount({ name: "Zoe", email: "zoe@example.com" });
    const ada = await createTestAccount({ name: "Ada", email: "ada@example.com" });
    await addTeamMember(actor, team.id, { accountId: zoe.id });
    await addTeamMember(actor, team.id, { accountId: ada.id });
    await getDb().update(accounts).set({ disabledAt: new Date() }).where(eq(accounts.id, zoe.id));

    expect((await getTeam(actor, team.id)).members).toEqual([
      { id: ada.id, name: "Ada", active: true },
      { id: zoe.id, name: "Zoe", active: false },
    ]);
  });
});

describe("deleteTeam", () => {
  it("deletes the team and its memberships, recording the name and member count", async () => {
    const { actor } = await manager();
    const team = await createTeam(actor, { name: "Frontend" });
    const ada = await createTestAccount({ name: "Ada", email: "ada@example.com" });
    await addTeamMember(actor, team.id, { accountId: ada.id });

    await deleteTeam(actor, team.id);

    expect(await getDb().select().from(teams)).toHaveLength(0);
    expect(await getDb().select().from(teamMembers)).toHaveLength(0);
    expect((await audits()).at(-1)).toMatchObject({
      action: "team.deleted",
      entityId: team.id,
      data: { name: "Frontend", memberCount: 1 },
    });
    expect((await failure(deleteTeam(actor, team.id))).status).toBe(404);
  });
});

describe("reading teams", () => {
  it("lists teams by name with member counts, in pages that join up", async () => {
    const { actor } = await manager();
    const viewer = testActor(await createTestAccount({ email: "v@example.com", role: "viewer" }));
    const ada = await createTestAccount({ name: "Ada", email: "ada@example.com" });
    for (const name of ["Delta", "alpha", "Charlie", "Bravo"]) {
      await createTeam(actor, { name });
    }
    const [alpha] = (await listTeams(viewer, { limit: 1 })).items;
    await addTeamMember(actor, alpha?.id ?? "", { accountId: ada.id });

    const first = await listTeams(viewer, { limit: 3 });
    const second = await listTeams(viewer, { limit: 3, cursor: first.nextCursor ?? "" });

    expect([...first.items, ...second.items].map((team) => team.name)).toEqual([
      "alpha",
      "Bravo",
      "Charlie",
      "Delta",
    ]);
    expect(first.items[0]?.memberCount).toBe(1);
    expect(second.nextCursor).toBeNull();
  });

  it("answers 404 for an unknown team", async () => {
    const { actor } = await manager();

    expect((await failure(getTeam(actor, UNKNOWN))).status).toBe(404);
  });
});

describe("audit and change are one", () => {
  it("leaves nothing behind when any of the five audit writes fails", async () => {
    const { actor } = await manager();
    const ada = await createTestAccount({ name: "Ada", email: "ada@example.com" });

    const failing = async (action: string, attempt: () => Promise<unknown>) => {
      const restore = await failAuditFor(action);
      try {
        await expect(attempt(), action).rejects.toThrow();
      } finally {
        await restore();
      }
    };

    await failing("team.created", () => createTeam(actor, { name: "Lost" }));
    expect(await getDb().select().from(teams)).toHaveLength(0);

    const team = await createTeam(actor, { name: "Kept" });
    await failing("team.renamed", () => renameTeam(actor, team.id, { name: "Other" }));
    expect((await getTeam(actor, team.id)).name).toBe("Kept");

    await failing("team.member_added", () => addTeamMember(actor, team.id, { accountId: ada.id }));
    expect((await getTeam(actor, team.id)).members).toEqual([]);

    await addTeamMember(actor, team.id, { accountId: ada.id });
    await failing("team.member_removed", () => removeTeamMember(actor, team.id, ada.id));
    expect((await getTeam(actor, team.id)).members).toHaveLength(1);

    await failing("team.deleted", () => deleteTeam(actor, team.id));
    expect(await getDb().select().from(teams)).toHaveLength(1);
  });
});
