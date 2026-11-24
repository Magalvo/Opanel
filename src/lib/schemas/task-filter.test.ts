import { describe, expect, it } from "vitest";

import { backlogQuerySchema, taskListQuerySchema } from "./tasks";

// The filters of the task lists (WS-116 section 2, test 1).

const TEAM = "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f";

function paths(result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) {
  return (result.error?.issues ?? []).map((issue) => issue.path.join("."));
}

describe("taskListQuerySchema filters (WS-116)", () => {
  it("reads one value and repeated values as arrays", () => {
    const one = taskListQuerySchema.parse({ priority: "high", type: "bug" });
    const many = taskListQuerySchema.parse({ priority: ["high", "urgent"] });

    expect(one).toMatchObject({ priority: ["high"], type: ["bug"], limit: 50 });
    expect(many.priority).toEqual(["high", "urgent"]);
  });

  it("reads none, me, backlog and done", () => {
    const query = taskListQuerySchema.parse({
      assigneeTeamId: ["none", TEAM],
      assigneeAccountId: "me",
      reporterAccountId: "me",
      epicId: "none",
      columnId: ["backlog", TEAM],
      done: "false",
    });

    expect(query).toMatchObject({
      assigneeTeamId: ["none", TEAM],
      assigneeAccountId: ["me"],
      reporterAccountId: ["me"],
      epicId: ["none"],
      columnId: ["backlog", TEAM],
      done: false,
    });
  });

  it("refuses unknown values, more than 20 values, and me where it means nothing", () => {
    expect(paths(taskListQuerySchema.safeParse({ priority: "huge" }))).toEqual(["priority"]);
    expect(
      paths(taskListQuerySchema.safeParse({ type: Array.from({ length: 21 }, () => "bug") })),
    ).toEqual(["type"]);
    expect(paths(taskListQuerySchema.safeParse({ assigneeTeamId: "me" }))).toEqual([
      "assigneeTeamId",
    ]);
    expect(paths(taskListQuerySchema.safeParse({ reporterKind: "robot" }))).toEqual([
      "reporterKind",
    ]);
    expect(paths(taskListQuerySchema.safeParse({ done: "yes" }))).toEqual(["done"]);
    expect(paths(taskListQuerySchema.safeParse({ colour: "red" }))).not.toEqual([]);
  });

  it("refuses dueFrom after dueTo, on dueTo", () => {
    expect(
      paths(taskListQuerySchema.safeParse({ dueFrom: "2030-02-01", dueTo: "2030-01-31" })),
    ).toEqual(["dueTo"]);
    expect(
      taskListQuerySchema.safeParse({ dueFrom: "2030-01-31", dueTo: "2030-01-31" }).success,
    ).toBe(true);
  });

  it("refuses a q with no letter or digit, an empty one, and one over 200 characters", () => {
    expect(paths(taskListQuerySchema.safeParse({ q: "--" }))).toEqual(["q"]);
    expect(paths(taskListQuerySchema.safeParse({ q: "   " }))).toEqual(["q"]);
    expect(paths(taskListQuerySchema.safeParse({ q: "a".repeat(201) }))).toEqual(["q"]);
    expect(taskListQuerySchema.parse({ q: "  café 2 " }).q).toBe("café 2");
  });

  it("gives the backlog every filter but columnId", () => {
    expect(backlogQuerySchema.parse({ priority: "high", q: "login" })).toMatchObject({
      priority: ["high"],
      q: "login",
    });
    expect(backlogQuerySchema.safeParse({ columnId: TEAM }).success).toBe(false);
  });
});
