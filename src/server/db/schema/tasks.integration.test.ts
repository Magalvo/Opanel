// What the database itself refuses about a task's parent (WS-133 test 1). Raw SQL on purpose,
// as triage.integration.test.ts: these rules must hold without the services.
import { describe, expect, it } from "vitest";

import { getDb } from "../client";

const client = () => getDb().$client;

/** The constraint or the error code a statement fails with; throws if it succeeds. */
async function refusal(statement: Promise<unknown>): Promise<string> {
  try {
    await statement;
  } catch (error) {
    const { constraint_name: constraint, code } = error as {
      constraint_name?: string;
      code?: string;
    };
    return constraint ?? code ?? "unknown";
  }
  throw new Error("the statement was accepted");
}

async function one(rows: Promise<{ id: string }[]>): Promise<string> {
  const [row] = await rows;
  if (!row) throw new Error("no row");
  return row.id;
}

async function setup() {
  const reporter = await one(client()<{ id: string }[]>`
    insert into accounts (kind, name, email, role)
    values ('human', 'Ada', ${`${crypto.randomUUID()}@example.com`}, 'member') returning id`);
  const project = await one(client()<{ id: string }[]>`
    insert into projects (key, name) values ('OPA', 'Opanel') returning id`);
  const insertTask = (number: number, parent: string | null = null) =>
    one(client()<{ id: string }[]>`
      insert into tasks (project_id, number, title, position, reporter_account_id, parent_task_id)
      values (${project}, ${number}, ${`Task ${String(number)}`}, ${`a${String(number)}`},
        ${reporter}, ${parent})
      returning id`);
  return { insertTask };
}

describe("tasks.parent_task_id (WS-133 test 1)", () => {
  it("refuses a task as its own parent", async () => {
    const { insertTask } = await setup();
    const task = await insertTask(1);

    expect(await refusal(client()`update tasks set parent_task_id = id where id = ${task}`)).toBe(
      "tasks_parent_not_self_check",
    );
  });

  it("refuses removing a parent row that a sub-task references", async () => {
    const { insertTask } = await setup();
    const parent = await insertTask(1);
    await insertTask(2, parent);

    expect(await refusal(client()`delete from tasks where id = ${parent}`)).toBe(
      "tasks_parent_task_id_tasks_id_fk",
    );
  });

  it("accepts a sub-task of a live task", async () => {
    const { insertTask } = await setup();
    const parent = await insertTask(1);

    const child = await insertTask(2, parent);

    const [row] = await client()<{ parent_task_id: string }[]>`
      select parent_task_id from tasks where id = ${child}`;
    expect(row?.parent_task_id).toBe(parent);
  });
});

describe("tasks.sprint_id (WS-141 test 1)", () => {
  it("refuses deleting a sprint that a task references", async () => {
    const { insertTask } = await setup();
    const task = await insertTask(1);
    const [project] = await client()<
      { id: string }[]
    >`select project_id as id from tasks where id = ${task}`;
    const sprint = await one(client()<{ id: string }[]>`
      insert into sprints (project_id, name, start_date, end_date)
      values (${project?.id ?? ""}, 'Sprint 1', '2026-12-01', '2026-12-14') returning id`);
    await client()`update tasks set sprint_id = ${sprint} where id = ${task}`;

    expect(await refusal(client()`delete from sprints where id = ${sprint}`)).toBe(
      "tasks_sprint_id_sprints_id_fk",
    );
  });
});
