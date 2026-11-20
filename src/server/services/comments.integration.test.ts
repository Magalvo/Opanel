import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { agentActor } from "@/server/auth/actor";
import { createTestAccount, createTestAgent, testActor } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { comments, taskEvents } from "@/server/db/schema";
import { ApiError } from "@/server/http/errors";

import { addSystemComment, createComment, listComments } from "./comments";
import { listenForEvents } from "./events-testing";
import { archiveProject, createProject } from "./projects";
import { createTask, deleteTask, getTask } from "./tasks";

async function setup() {
  const managerAccount = await createTestAccount({ email: "manager@example.com", role: "manager" });
  const manager = testActor(managerAccount);
  const memberAccount = await createTestAccount({
    name: "Mia",
    email: "mia@example.com",
    role: "member",
  });
  const member = testActor(memberAccount);
  const viewer = testActor(await createTestAccount({ email: "vic@example.com", role: "viewer" }));
  await createProject(manager, { key: "OPA", name: "Opanel" });
  const task = await createTask(member, "OPA", { title: "First" });
  return { manager, member, memberAccount, viewer, task };
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

async function eventsOf(taskId: string) {
  return getDb()
    .select()
    .from(taskEvents)
    .where(eq(taskEvents.taskId, taskId))
    .orderBy(taskEvents.id);
}

describe("the author's kind (WS-074)", () => {
  it("is agent for an agent's comment and human for a person's, created and listed", async () => {
    const { member, memberAccount } = await setup();
    const scopes = ["projects:read", "tasks:read", "comments:write"] as const;
    const account = await createTestAgent({ name: "QA Bot", scopes: [...scopes] });
    const bot = agentActor({ accountId: account.id, role: "qa_agent", scopes, projectIds: null });

    const byBot = await createComment(bot, "OPA-1", { body: "Found a bug" });
    await createComment(member, "OPA-1", { body: "Thanks" });

    expect(byBot.author).toEqual({ id: account.id, name: "QA Bot", kind: "agent" });
    const listed = await listComments(member, "OPA-1", { limit: 50 });
    expect(listed.items.map((comment) => comment.author)).toEqual([
      { id: account.id, name: "QA Bot", kind: "agent" },
      { id: memberAccount.id, name: "Mia", kind: "human" },
    ]);
  });
});

describe("createComment", () => {
  it("stores the body as written, with kind user and the actor as author", async () => {
    const { member, memberAccount, task } = await setup();

    const comment = await createComment(member, "OPA-1", { body: "  **Seen** it\n" });

    expect(comment).toMatchObject({
      taskId: task.id,
      kind: "user",
      author: { id: memberAccount.id, name: "Mia", kind: "human" },
      body: "  **Seen** it\n",
    });
    expect(comment.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const [row] = await getDb().select().from(comments);
    expect(row).toMatchObject({ id: comment.id, authorAccountId: memberAccount.id });
  });

  it("finds the task by id as well as by key", async () => {
    const { manager, task } = await setup();

    const comment = await createComment(manager, task.id, { body: "By id" });

    expect(comment.taskId).toBe(task.id);
  });

  it("records one commented event pointing at the comment, with the actor", async () => {
    const { member, memberAccount, task } = await setup();
    const before = (await eventsOf(task.id)).length;

    const comment = await createComment(member, "OPA-1", { body: "Hi" });

    const events = (await eventsOf(task.id)).slice(before);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "commented",
      actorAccountId: memberAccount.id,
      field: null,
      oldValue: null,
      newValue: { commentId: comment.id },
    });
  });

  it("leaves the task's version and updated_at as they were", async () => {
    const { member, task } = await setup();

    await createComment(member, "OPA-1", { body: "Hi" });

    const after = await getTask(member, "OPA-1");
    expect(after.version).toBe(task.version);
    expect(after.updatedAt).toBe(task.updatedAt);
  });

  it("is refused to a Viewer, on a deleted or unknown task and in an archived project, writing nothing", async () => {
    const { manager, member, viewer } = await setup();
    await createTask(member, "OPA", { title: "Second" });
    await deleteTask(member, "OPA-2");

    expect((await failure(createComment(viewer, "OPA-1", { body: "Hi" }))).status).toBe(403);
    expect((await failure(createComment(member, "OPA-2", { body: "Hi" }))).status).toBe(404);
    expect((await failure(createComment(member, "OPA-99", { body: "Hi" }))).status).toBe(404);
    await archiveProject(manager, "OPA");
    const archived = await failure(createComment(member, "OPA-1", { body: "Hi" }));
    expect(archived.status).toBe(409);
    expect(archived.code).toBe("project_archived");

    expect(await getDb().select().from(comments)).toHaveLength(0);
    expect(
      (await getDb().select().from(taskEvents)).filter((event) => event.type === "commented"),
    ).toHaveLength(0);
  });

  it("rolls the comment back when its history event cannot be written", async () => {
    const { member } = await setup();
    await getDb().execute(sql`
      create function fail_test_task_event() returns trigger as $$
      begin raise exception 'event write failed'; end; $$ language plpgsql`);
    await getDb().execute(sql`
      create trigger fail_test_task_event before insert on task_events
      for each row when (new.type = 'commented') execute function fail_test_task_event()`);
    try {
      await expect(createComment(member, "OPA-1", { body: "Lost" })).rejects.toThrow();
    } finally {
      await getDb().execute(sql`drop trigger fail_test_task_event on task_events`);
      await getDb().execute(sql`drop function fail_test_task_event()`);
    }

    expect(await getDb().select().from(comments)).toHaveLength(0);
  });

  it("never adds a comment after a delete of the same task that runs at the same time", async () => {
    const { member } = await setup();

    for (let i = 2; i < 22; i++) {
      await createTask(member, "OPA", { title: `Race ${String(i)}` });
      const key = `OPA-${String(i)}`;
      const [commented, deleted] = await Promise.allSettled([
        createComment(member, key, { body: "Racing" }),
        deleteTask(member, key),
      ]);

      expect(deleted.status).toBe("fulfilled");
      if (commented.status === "rejected") {
        expect((commented.reason as ApiError).status).toBe(404);
        continue;
      }
      // The comment committed first: its event comes before the delete's.
      const types = (await eventsOf(commented.value.taskId)).map((event) => event.type);
      expect(types.indexOf("commented")).toBeLessThan(types.indexOf("deleted"));
    }
  }, 60_000);
});

describe("listComments", () => {
  it("lists oldest first for every role, in pages that join up", async () => {
    const { manager, member, viewer } = await setup();
    const bodies = ["one", "two", "three", "four", "five"];
    for (const body of bodies) {
      await createComment(body === "three" ? manager : member, "OPA-1", { body });
    }

    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await listComments(viewer, "OPA-1", {
        limit: 2,
        ...(cursor === undefined ? {} : { cursor }),
      });
      seen.push(...page.items.map((item) => item.body));
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);

    expect(seen).toEqual(bodies);
  });

  it("keeps a stable order for comments created in the same instant", async () => {
    const { member, memberAccount, task } = await setup();
    await getDb().transaction(async (tx) => {
      for (const body of ["a", "b", "c", "d"]) {
        await tx
          .insert(comments)
          .values({ taskId: task.id, authorAccountId: memberAccount.id, body });
      }
    });

    const all = (await listComments(member, "OPA-1", { limit: 50 })).items.map((c) => c.id);
    const paged: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await listComments(member, "OPA-1", {
        limit: 1,
        ...(cursor === undefined ? {} : { cursor }),
      });
      paged.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);

    expect(paged).toEqual(all);
    expect(new Set(paged).size).toBe(4);
  });

  it("shows a system comment with no author", async () => {
    const { member, task } = await setup();
    await getDb().execute(sql`
      insert into comments (task_id, kind, body) values (${task.id}, 'system', 'Seen again')`);

    const [comment] = (await listComments(member, "OPA-1", { limit: 50 })).items;

    expect(comment).toMatchObject({ kind: "system", author: null, body: "Seen again" });
  });

  it("answers 404 for a deleted or unknown task and 400 for a bad cursor", async () => {
    const { member } = await setup();
    await createTask(member, "OPA", { title: "Second" });
    await deleteTask(member, "OPA-2");

    expect((await failure(listComments(member, "OPA-2", { limit: 50 }))).status).toBe(404);
    expect((await failure(listComments(member, "OPA-99", { limit: 50 }))).status).toBe(404);
    expect(
      (await failure(listComments(member, "OPA-1", { limit: 50, cursor: "nonsense" }))).status,
    ).toBe(400);
  });

  it("still lists the comments of an archived project", async () => {
    const { manager, member } = await setup();
    await createComment(member, "OPA-1", { body: "Before" });
    await archiveProject(manager, "OPA");

    expect((await listComments(member, "OPA-1", { limit: 50 })).items).toHaveLength(1);
  });
});

describe("addSystemComment (WS-089)", () => {
  it("adds an authorless system comment, a commented entry by the actor, and comment.created", async () => {
    const { member, memberAccount, task } = await setup();
    const listener = await listenForEvents();

    try {
      await getDb().transaction(async (tx) => {
        await addSystemComment(tx, member, task, "Reported again by QA Bot.");
      });
      await listener.settle();

      const [comment] = await getDb().select().from(comments).where(eq(comments.taskId, task.id));
      expect(comment).toMatchObject({
        kind: "system",
        authorAccountId: null,
        body: "Reported again by QA Bot.",
      });
      expect((await eventsOf(task.id)).at(-1)).toMatchObject({
        type: "commented",
        actorAccountId: memberAccount.id,
        newValue: { commentId: comment?.id },
      });
      expect(
        listener
          .events()
          .filter((event) => event.projectId === task.projectId)
          .map((event) => [event.type, event.entityId, event.actorAccountId]),
      ).toEqual([["comment.created", comment?.id, memberAccount.id]]);
      const listed = await listComments(member, task.key, { limit: 50 });
      expect(listed.items[0]).toMatchObject({ kind: "system", author: null });
    } finally {
      await listener.close();
    }
  });
});
