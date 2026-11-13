import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createTestAccount, failAuditFor, testActor } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { auditLog, columns, projects } from "@/server/db/schema";
import { ApiError } from "@/server/http/errors";

import {
  archiveProject,
  createProject,
  getProject,
  listProjects,
  lockWritableProject,
  unarchiveProject,
  updateProject,
} from "./projects";

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

describe("createProject", () => {
  it("creates the project with its three default columns and records project.created", async () => {
    const { account, actor } = await manager();

    const project = await createProject(actor, { key: "OPA", name: "Opanel" });

    expect(project).toMatchObject({
      key: "OPA",
      name: "Opanel",
      description: "",
      archivedAt: null,
      version: 1,
    });
    const created = await getDb()
      .select()
      .from(columns)
      .where(eq(columns.projectId, project.id))
      .orderBy(asc(columns.position));
    expect(created.map((column) => [column.name, column.category, column.position])).toEqual([
      ["To do", "todo", "a0"],
      ["In progress", "in_progress", "a1"],
      ["Done", "done", "a2"],
    ]);
    expect(await audits()).toEqual([
      expect.objectContaining({
        actorAccountId: account.id,
        action: "project.created",
        entity: "project",
        entityId: project.id,
        data: { key: "OPA", name: "Opanel" },
      }),
    ]);
  });

  it("leaves no project and no column when the audit write fails", async () => {
    const { actor } = await manager();
    const restore = await failAuditFor("project.created");
    try {
      await expect(createProject(actor, { key: "OPA", name: "Opanel" })).rejects.toThrow();
    } finally {
      await restore();
    }

    expect(await getDb().select().from(projects)).toHaveLength(0);
    expect(await getDb().select().from(columns)).toHaveLength(0);
  });

  it("refuses a taken key, also under concurrent creation", async () => {
    const { actor } = await manager();
    await createProject(actor, { key: "OPA", name: "Opanel" });

    expect((await failure(createProject(actor, { key: "OPA", name: "Other" }))).code).toBe(
      "project_key_taken",
    );

    const results = await Promise.allSettled([
      createProject(actor, { key: "WEB", name: "One" }),
      createProject(actor, { key: "WEB", name: "Two" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toMatchObject({
      code: "project_key_taken",
    });
    expect(await getDb().select().from(columns)).toHaveLength(6);
  });

  it("needs projects:manage", async () => {
    const member = testActor(await createTestAccount({ email: "m@example.com", role: "member" }));

    expect((await failure(createProject(member, { key: "OPA", name: "O" }))).status).toBe(403);
  });
});

describe("getProject", () => {
  it("finds a project by id or by key, and answers 404 otherwise", async () => {
    const { actor } = await manager();
    const project = await createProject(actor, { key: "OPA", name: "Opanel", description: "*x*" });

    expect(await getProject(actor, project.id)).toEqual(project);
    expect(await getProject(actor, "OPA")).toEqual(project);
    expect((await failure(getProject(actor, UNKNOWN))).status).toBe(404);
    expect((await failure(getProject(actor, "NOPE"))).status).toBe(404);
  });
});

describe("updateProject", () => {
  it("changes the name and description, bumps version and records the changed fields", async () => {
    const { actor } = await manager();
    const project = await createProject(actor, { key: "OPA", name: "Opanel" });

    const updated = await updateProject(actor, "OPA", {
      name: "Opanel board",
      description: "Our *board*",
      version: 1,
    });

    expect(updated).toMatchObject({ name: "Opanel board", description: "Our *board*", version: 2 });
    expect((await audits()).at(-1)).toMatchObject({
      action: "project.updated",
      entityId: project.id,
      data: { changed: ["name", "description"] },
    });
  });

  it("answers version_conflict with the current project when version is stale", async () => {
    const { actor } = await manager();
    await createProject(actor, { key: "OPA", name: "Opanel" });
    const current = await updateProject(actor, "OPA", { name: "First", version: 1 });

    const error = await failure(updateProject(actor, "OPA", { name: "Second", version: 1 }));

    expect(error.status).toBe(409);
    expect(error.code).toBe("version_conflict");
    expect(error.current).toEqual(current);
    expect((await getProject(actor, "OPA")).name).toBe("First");
  });

  it("bumps version without an audit entry when nothing changes, and answers 404 for an unknown project", async () => {
    const { actor } = await manager();
    await createProject(actor, { key: "OPA", name: "Opanel" });

    const same = await updateProject(actor, "OPA", { name: "Opanel", version: 1 });

    expect(same.version).toBe(2);
    expect(await audits()).toHaveLength(1);
    expect((await failure(updateProject(actor, UNKNOWN, { name: "X", version: 1 }))).status).toBe(
      404,
    );
  });
});

describe("archiving", () => {
  it("archives and unarchives idempotently, and blocks edits while archived", async () => {
    const { actor } = await manager();
    await createProject(actor, { key: "OPA", name: "Opanel" });

    const archived = await archiveProject(actor, "OPA");
    const again = await archiveProject(actor, "OPA");

    expect(archived.archivedAt).not.toBeNull();
    expect(archived.version).toBe(2);
    expect(again).toEqual(archived);
    expect((await failure(updateProject(actor, "OPA", { name: "X", version: 2 }))).code).toBe(
      "project_archived",
    );

    const restored = await unarchiveProject(actor, "OPA");
    await unarchiveProject(actor, "OPA");

    expect(restored).toMatchObject({ archivedAt: null, version: 3 });
    expect((await updateProject(actor, "OPA", { name: "Back", version: 3 })).name).toBe("Back");
    expect((await audits()).map((entry) => entry.action)).toEqual([
      "project.created",
      "project.archived",
      "project.unarchived",
      "project.updated",
    ]);
  });
});

describe("listProjects", () => {
  it("lists active projects by default and archived ones on request, by name ignoring case", async () => {
    const { actor } = await manager();
    const viewer = testActor(await createTestAccount({ email: "v@example.com", role: "viewer" }));
    for (const [key, name] of [
      ["DD", "delta"],
      ["AA", "Alpha"],
      ["CC", "charlie"],
      ["BB", "Bravo"],
      ["OLD", "Old"],
    ] as const) {
      await createProject(actor, { key, name });
    }
    await archiveProject(actor, "OLD");

    const first = await listProjects(viewer, { limit: 3 });
    const second = await listProjects(viewer, { limit: 3, cursor: first.nextCursor ?? "" });
    const archived = await listProjects(viewer, { limit: 50, archived: "true" });

    expect([...first.items, ...second.items].map((project) => project.key)).toEqual([
      "AA",
      "BB",
      "CC",
      "DD",
    ]);
    expect(second.nextCursor).toBeNull();
    expect(archived.items.map((project) => project.key)).toEqual(["OLD"]);
  });
});

describe("lockWritableProject", () => {
  it("returns a writable project, 404 for an unknown one and project_archived for an archived one", async () => {
    const { actor } = await manager();
    const project = await createProject(actor, { key: "OPA", name: "Opanel" });
    await createProject(actor, { key: "OLD", name: "Old" });
    await archiveProject(actor, "OLD");

    const locked = await getDb().transaction((tx) => lockWritableProject(tx, "OPA"));

    expect(locked).toMatchObject({ id: project.id, key: "OPA" });
    expect(
      (await failure(getDb().transaction((tx) => lockWritableProject(tx, UNKNOWN)))).status,
    ).toBe(404);
    expect((await failure(getDb().transaction((tx) => lockWritableProject(tx, "OLD")))).code).toBe(
      "project_archived",
    );
  });
});
