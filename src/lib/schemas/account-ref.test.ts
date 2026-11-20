import { describe, expect, it } from "vitest";

import { accountKindSchema, accountRefSchema } from "./account-ref";
import { commentSchema } from "./comments";
import { taskSummarySchema } from "./tasks";

const ID = "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f";

describe("account references (WS-074)", () => {
  it("has the kinds human and agent", () => {
    expect(accountKindSchema.options).toEqual(["human", "agent"]);
  });

  it("accepts a human and an agent", () => {
    for (const kind of ["human", "agent"] as const) {
      expect(accountRefSchema.parse({ id: ID, name: "QA Bot", kind })).toEqual({
        id: ID,
        name: "QA Bot",
        kind,
      });
    }
  });

  it("refuses a missing kind, another kind and an extra key", () => {
    expect(accountRefSchema.safeParse({ id: ID, name: "QA Bot" }).success).toBe(false);
    expect(accountRefSchema.safeParse({ id: ID, name: "QA Bot", kind: "bot" }).success).toBe(false);
    expect(
      accountRefSchema.safeParse({ id: ID, name: "QA Bot", kind: "agent", role: "qa_agent" })
        .success,
    ).toBe(false);
  });

  it("is the shape of a task's reporter and a comment's author, both needing kind", () => {
    const task = {
      id: ID,
      key: "OPA-1",
      number: 1,
      projectId: ID,
      type: "task",
      title: "T",
      columnId: ID,
      assigneeTeam: null,
      assignee: null,
      epic: null,
      reporter: { id: ID, name: "QA Bot", kind: "agent" },
      severity: null,
      fingerprint: null,
      occurrences: 0,
      lastReportedAt: null,
      version: 1,
      createdAt: "2026-11-19T10:00:00.000Z",
      updatedAt: "2026-11-19T10:00:00.000Z",
      deletedAt: null,
    };
    const comment = {
      id: ID,
      taskId: ID,
      kind: "user",
      author: { id: ID, name: "QA Bot", kind: "agent" },
      body: "Hi",
      createdAt: "2026-11-19T10:00:00.000Z",
    };

    expect(taskSummarySchema.safeParse(task).success).toBe(true);
    expect(commentSchema.safeParse(comment).success).toBe(true);
    expect(
      taskSummarySchema.safeParse({ ...task, reporter: { id: ID, name: "QA Bot" } }).success,
    ).toBe(false);
    expect(
      commentSchema.safeParse({ ...comment, author: { id: ID, name: "QA Bot" } }).success,
    ).toBe(false);
    expect(commentSchema.safeParse({ ...comment, kind: "system", author: null }).success).toBe(
      true,
    );
  });
});
