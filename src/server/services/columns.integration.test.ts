import { describe, expect, it } from "vitest";

import { createTestAccount, failAuditFor, testActor } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { auditLog, columns } from "@/server/db/schema";
import { ApiError } from "@/server/http/errors";

import { createColumn, deleteColumn, listColumns, moveColumn, updateColumn } from "./columns";
import { archiveProject, createProject } from "./projects";

const UNKNOWN = "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f";

async function setup() {
  const account = await createTestAccount({ email: "manager@example.com", role: "manager" });
  const actor = testActor(account);
  const project = await createProject(actor, { key: "OPA", name: "Opanel" });
  return { account, actor, project };
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

async function names(actor: Awaited<ReturnType<typeof setup>>["actor"], ref = "OPA") {
  return (await listColumns(actor, ref)).items.map((column) => column.name);
}

async function audits() {
  return getDb().select().from(auditLog).orderBy(auditLog.id);
}

describe("listColumns", () => {
  it("returns the default columns in order, whole, by project id or key", async () => {
    const { actor, project } = await setup();
    const viewer = testActor(await createTestAccount({ email: "v@example.com", role: "viewer" }));

    const list = await listColumns(viewer, project.id);

    expect(list.nextCursor).toBeNull();
    expect(list.items.map((column) => [column.name, column.category, column.version])).toEqual([
      ["To do", "todo", 1],
      ["In progress", "in_progress", 1],
      ["Done", "done", 1],
    ]);
    expect(list.items[0]?.projectId).toBe(project.id);
    expect(Object.keys(list.items[0] ?? {})).not.toContain("position");
    expect(await names(actor, "OPA")).toEqual(["To do", "In progress", "Done"]);
    expect((await failure(listColumns(actor, "NOPE"))).status).toBe(404);
  });
});

describe("createColumn", () => {
  it("adds at the end by default, first with null, after a given column, with audit", async () => {
    const { account, actor, project } = await setup();
    const [todo] = (await listColumns(actor, "OPA")).items;

    const last = await createColumn(actor, "OPA", { name: "Shipped", category: "done" });
    await createColumn(actor, "OPA", { name: "Ideas", category: "todo", afterColumnId: null });
    await createColumn(actor, "OPA", {
      name: "Ready",
      category: "todo",
      afterColumnId: todo?.id ?? "",
    });

    expect(await names(actor)).toEqual([
      "Ideas",
      "To do",
      "Ready",
      "In progress",
      "Done",
      "Shipped",
    ]);
    expect(last).toMatchObject({ name: "Shipped", category: "done", version: 1 });
    expect((await audits()).find((entry) => entry.action === "column.created")).toMatchObject({
      actorAccountId: account.id,
      entity: "column",
      entityId: last.id,
      data: { projectId: project.id, name: "Shipped", category: "done" },
    });
  });

  it("refuses an anchor from another project with 400 on afterColumnId", async () => {
    const { actor } = await setup();
    await createProject(actor, { key: "WEB", name: "Web" });
    const [other] = (await listColumns(actor, "WEB")).items;

    const error = await failure(
      createColumn(actor, "OPA", { name: "X", category: "todo", afterColumnId: other?.id ?? "" }),
    );

    expect(error.status).toBe(400);
    expect(error.errors?.map((field) => field.path)).toEqual(["afterColumnId"]);
  });
});

describe("updateColumn", () => {
  it("renames and recategorises with an audit of the changed fields, and detects stale versions", async () => {
    const { actor } = await setup();
    const [todo] = (await listColumns(actor, "OPA")).items;
    const id = todo?.id ?? "";

    const renamed = await updateColumn(actor, id, {
      name: "Backlog",
      category: "todo",
      version: 1,
    });

    expect(renamed).toMatchObject({ name: "Backlog", version: 2 });
    expect((await audits()).at(-1)).toMatchObject({
      action: "column.updated",
      data: { changed: ["name"] },
    });

    const error = await failure(updateColumn(actor, id, { name: "Old", version: 1 }));
    expect(error.code).toBe("version_conflict");
    expect(error.current).toEqual(renamed);
    expect((await failure(updateColumn(actor, UNKNOWN, { name: "X", version: 1 }))).status).toBe(
      404,
    );
  });
});

describe("the last done column", () => {
  it("cannot be recategorised or deleted, but one of two can", async () => {
    const { actor } = await setup();
    const done = (await listColumns(actor, "OPA")).items.find(
      (column) => column.category === "done",
    );
    const id = done?.id ?? "";

    expect((await failure(updateColumn(actor, id, { category: "todo", version: 1 }))).code).toBe(
      "last_done_column",
    );
    expect((await failure(deleteColumn(actor, id))).code).toBe("last_done_column");

    await createColumn(actor, "OPA", { name: "Shipped", category: "done" });
    await deleteColumn(actor, id);

    expect(await names(actor)).toEqual(["To do", "In progress", "Shipped"]);
  });
});

describe("moveColumn", () => {
  it("moves to first, between two and to last; its own place writes no audit", async () => {
    const { actor } = await setup();
    const [todo, progress, done] = (await listColumns(actor, "OPA")).items;

    const first = await moveColumn(actor, done?.id ?? "", { afterColumnId: null, version: 1 });
    expect(await names(actor)).toEqual(["Done", "To do", "In progress"]);
    await moveColumn(actor, done?.id ?? "", {
      afterColumnId: todo?.id ?? "",
      version: first.version,
    });
    expect(await names(actor)).toEqual(["To do", "Done", "In progress"]);
    const back = await moveColumn(actor, done?.id ?? "", {
      afterColumnId: progress?.id ?? "",
      version: 3,
    });
    expect(await names(actor)).toEqual(["To do", "In progress", "Done"]);

    const before = (await audits()).length;
    const same = await moveColumn(actor, done?.id ?? "", {
      afterColumnId: progress?.id ?? "",
      version: back.version,
    });
    expect(same.version).toBe(back.version + 1);
    expect(await audits()).toHaveLength(before);
    expect((await audits()).filter((entry) => entry.action === "column.moved")).toHaveLength(3);
  });

  it("refuses the column itself as anchor, and a stale version", async () => {
    const { actor } = await setup();
    const [todo] = (await listColumns(actor, "OPA")).items;
    const id = todo?.id ?? "";

    expect((await failure(moveColumn(actor, id, { afterColumnId: id, version: 1 }))).status).toBe(
      400,
    );
    expect((await failure(moveColumn(actor, id, { afterColumnId: null, version: 9 }))).code).toBe(
      "version_conflict",
    );
  });
});

describe("deleteColumn", () => {
  it("deletes with audit, and answers 404 for an unknown column", async () => {
    const { actor, project } = await setup();
    const [todo] = (await listColumns(actor, "OPA")).items;

    await deleteColumn(actor, todo?.id ?? "");

    expect(await names(actor)).toEqual(["In progress", "Done"]);
    expect((await audits()).at(-1)).toMatchObject({
      action: "column.deleted",
      entityId: todo?.id,
      data: { projectId: project.id, name: "To do", category: "todo" },
    });
    expect((await failure(deleteColumn(actor, UNKNOWN))).status).toBe(404);
  });
});

describe("archived projects", () => {
  it("refuse every column write, and still list", async () => {
    const { actor } = await setup();
    const [todo] = (await listColumns(actor, "OPA")).items;
    const id = todo?.id ?? "";
    await archiveProject(actor, "OPA");

    // Each call starts only when awaited, so no rejection is left unhandled.
    for (const attempt of [
      () => createColumn(actor, "OPA", { name: "X", category: "todo" }),
      () => updateColumn(actor, id, { name: "X", version: 1 }),
      () => moveColumn(actor, id, { afterColumnId: null, version: 1 }),
      () => deleteColumn(actor, id),
    ]) {
      expect((await failure(attempt())).code).toBe("project_archived");
    }
    expect(await names(actor)).toHaveLength(3);
  });
});

describe("concurrency", () => {
  it("keeps one done column when the last two are deleted at once", async () => {
    const { actor } = await setup();
    await createColumn(actor, "OPA", { name: "Shipped", category: "done" });
    const done = (await listColumns(actor, "OPA")).items.filter(
      (column) => column.category === "done",
    );

    const results = await Promise.allSettled(done.map((column) => deleteColumn(actor, column.id)));

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const left = (await listColumns(actor, "OPA")).items.filter(
      (column) => column.category === "done",
    );
    expect(left).toHaveLength(1);
  });

  it("gives ten concurrent creations at the end ten distinct, ordered positions", async () => {
    const { actor } = await setup();

    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        createColumn(actor, "OPA", { name: `C${String(index)}`, category: "todo" }),
      ),
    );

    const rows = await getDb().select({ position: columns.position }).from(columns);
    expect(new Set(rows.map((row) => row.position)).size).toBe(13);
    expect(await names(actor)).toHaveLength(13);
  });
});

describe("audit and change are one", () => {
  it("leaves nothing behind when any of the four audit writes fails", async () => {
    const { actor } = await setup();
    const [todo, progress] = (await listColumns(actor, "OPA")).items;

    const failing = async (action: string, attempt: () => Promise<unknown>) => {
      const restore = await failAuditFor(action);
      try {
        await expect(attempt(), action).rejects.toThrow();
      } finally {
        await restore();
      }
    };

    await failing("column.created", () =>
      createColumn(actor, "OPA", { name: "X", category: "todo" }),
    );
    await failing("column.updated", () =>
      updateColumn(actor, todo?.id ?? "", { name: "Y", version: 1 }),
    );
    await failing("column.moved", () =>
      moveColumn(actor, todo?.id ?? "", { afterColumnId: progress?.id ?? "", version: 1 }),
    );
    await failing("column.deleted", () => deleteColumn(actor, todo?.id ?? ""));

    const list = await listColumns(actor, "OPA");
    expect(list.items.map((column) => [column.name, column.version])).toEqual([
      ["To do", 1],
      ["In progress", 1],
      ["Done", 1],
    ]);
  });
});
