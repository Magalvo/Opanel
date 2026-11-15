import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createTestAccount, testActor } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { comments, taskEvents, tasks } from "@/server/db/schema";
import { ApiError } from "@/server/http/errors";

import { createComment, listComments } from "./comments";
import { archiveProject, createProject } from "./projects";
import { createTask, deleteTask, restoreTask, updateTask } from "./tasks";

async function setup() {
  const managerAccount = await createTestAccount({
    name: "Max",
    email: "manager@example.com",
    role: "manager",
  });
  const manager = testActor(managerAccount);
  const miaAccount = await createTestAccount({
    name: "Mia",
    email: "mia@example.com",
    role: "member",
  });
  const member = testActor(miaAccount);
  const viewer = testActor(await createTestAccount({ email: "v@example.com", role: "viewer" }));
  await createProject(manager, { key: "OPA", name: "Opanel" });
  const task = await createTask(member, "OPA", { title: "Fix login" });
  return { manager, member, miaAccount, viewer, task };
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

describe("createComment", () => {
  it("returns the comment with its author, and stores the body exactly as sent", async () => {
    const { member, miaAccount, task } = await setup();
    const body = "  First line\n\n  *second*  \n";

    const comment = await createComment(member, "OPA-1", { body });

    expect(comment).toMatchObject({
      taskId: task.id,
      kind: "user",
      author: { id: miaAccount.id, name: "Mia" },
      body,
    });
    const [row] = await getDb().select().from(comments);
    expect(row?.body).toBe(body);
    expect(row?.authorAccountId).toBe(miaAccount.id);
  });

  it("works by task id as well as by key", async () => {
    const { member, task } = await setup();

    const comment = await createComment(member, task.id, { body: "By id" });

    expect(comment.taskId).toBe(task.id);
  });

  it("records one commented event pointing at the comment, and leaves the task alone", async () => {
    const { member, miaAccount, task } = await setup();
    const [before] = await getDb().select().from(tasks).where(eq(tasks.id, task.id));

    const comment = await createComment(member, "OPA-1", { body: "Hello" });

    const events = await getDb()
      .select()
      .from(taskEvents)
      .where(eq(taskEvents.taskId, task.id))
      .orderBy(taskEvents.id);
    expect(events.filter((event) => event.type === "commented")).toEqual([
      expect.objectContaining({
        actorAccountId: miaAccount.id,
        field: null,
        oldValue: null,
        newValue: { commentId: comment.id },
      }),
    ]);
    const [after] = await getDb().select().from(tasks).where(eq(tasks.id, task.id));
    expect(after?.version).toBe(before?.version);
    expect(after?.updatedAt).toEqual(before?.updatedAt);
  });

  it("leaves no comment when the event cannot be written", async () => {
    const { member } = await setup();
    await getDb().execute(sql`
      create function fail_comment_event() returns trigger as $$
      begin raise exception 'event write failed'; end;
      $$ language plpgsql`);
    await getDb().execute(sql`
      create trigger fail_comment_event before insert on task_events
      for each row when (new.type = 'commented')
      execute function fail_comment_event()`);
    try {
      await expect(createComment(member, "OPA-1", { body: "Hello" })).rejects.toThrow();
    } finally {
      await getDb().execute(sql`drop trigger fail_comment_event on task_events`);
      await getDb().execute(sql`drop function fail_comment_event()`);
    }

    expect(await getDb().select().from(comments)).toHaveLength(0);
  });

  it("lets Member, Manager and Admin comment and refuses a Viewer", async () => {
    const { manager, member, viewer } = await setup();
    const admin = testActor(await createTestAccount({ email: "a@example.com", role: "admin" }));

    for (const actor of [member, manager, admin]) {
      await expect(createComment(actor, "OPA-1", { body: "Hi" })).resolves.toBeDefined();
    }
    expect((await failure(createComment(viewer, "OPA-1", { body: "Hi" }))).status).toBe(403);
    expect(await getDb().select().from(comments)).toHaveLength(3);
  });

  it("answers 404 for an unknown or deleted task, and 409 in an archived project", async () => {
    const { manager, member } = await setup();

    expect((await failure(createComment(member, "OPA-9", { body: "x" }))).status).toBe(404);
    await deleteTask(member, "OPA-1");
    expect((await failure(createComment(member, "OPA-1", { body: "x" }))).status).toBe(404);
    expect((await failure(listComments(member, "OPA-1", { limit: 50 }))).status).toBe(404);

    await restoreTask(manager, "OPA-1");
    await archiveProject(manager, "OPA");
    const archived = await failure(createComment(member, "OPA-1", { body: "x" }));
    expect(archived).toMatchObject({ status: 409, code: "project_archived" });
    await expect(listComments(member, "OPA-1", { limit: 50 })).resolves.toBeDefined();
  });

  it("brings the comments back with a restored task", async () => {
    const { manager, member } = await setup();
    await createComment(member, "OPA-1", { body: "Before" });
    await deleteTask(manager, "OPA-1");
    await restoreTask(manager, "OPA-1");

    const page = await listComments(member, "OPA-1", { limit: 50 });

    expect(page.items.map((comment) => comment.body)).toEqual(["Before"]);
  });

  it("does not make a concurrent edit of the task fail, and keeps every comment", async () => {
    const { member, task } = await setup();
    const edit = updateTask(member, "OPA-1", { title: "Renamed", version: task.version });

    const results = await Promise.all([
      edit,
      ...Array.from({ length: 10 }, (_, i) =>
        createComment(member, "OPA-1", { body: `c${String(i)}` }),
      ),
    ]);

    expect(results[0]).toMatchObject({ title: "Renamed" });
    const page = await listComments(member, "OPA-1", { limit: 50 });
    expect(page.items).toHaveLength(10);
    expect(new Set(page.items.map((comment) => comment.id)).size).toBe(10);
  }, 30_000);
});

describe("listComments", () => {
  it("lists oldest first with the author's name", async () => {
    const { manager, member } = await setup();
    await createComment(member, "OPA-1", { body: "one" });
    await createComment(manager, "OPA-1", { body: "two" });
    await createComment(member, "OPA-1", { body: "three" });

    const page = await listComments(member, "OPA-1", { limit: 50 });

    expect(page.items.map((comment) => comment.body)).toEqual(["one", "two", "three"]);
    expect(page.items.map((comment) => comment.author?.name)).toEqual(["Mia", "Max", "Mia"]);
    expect(page.nextCursor).toBeNull();
  });

  it("lets a Viewer read", async () => {
    const { member, viewer } = await setup();
    await createComment(member, "OPA-1", { body: "one" });

    expect((await listComments(viewer, "OPA-1", { limit: 50 })).items).toHaveLength(1);
  });

  it("pages 120 comments with no repeat and no gap", async () => {
    const { member, task, miaAccount } = await setup();
    // One statement, so many rows share a creation time: the id has to break the ties.
    await getDb().execute(sql`
      insert into comments (task_id, author_account_id, body)
      select ${task.id}::uuid, ${miaAccount.id}::uuid, 'c' || n from generate_series(1, 120) n`);

    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await listComments(member, "OPA-1", {
        limit: 50,
        ...(cursor === undefined ? {} : { cursor }),
      });
      seen.push(...page.items.map((comment) => comment.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);

    expect(seen).toHaveLength(120);
    expect(new Set(seen).size).toBe(120);
    const all = await getDb().execute<{ id: string }>(
      sql`select id from comments order by created_at, id`,
    );
    expect(seen).toEqual(all.map((row) => row.id));
  });

  it("refuses a cursor it did not produce", async () => {
    const { member } = await setup();

    const error = await failure(listComments(member, "OPA-1", { limit: 50, cursor: "nonsense" }));

    expect(error.status).toBe(400);
  });
});
