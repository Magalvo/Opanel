import { describe, expect, it } from "vitest";

import { contracts } from "@/lib/openapi/contracts";

import { TASK_LINK_TYPES } from "./bug-reports";
import {
  addTaskLinkContract,
  MAX_TASK_LINKS,
  removeTaskLinkContract,
  taskLinkQuerySchema,
  taskLinkRequestSchema,
} from "./task-links";
import { taskLinkSchema } from "./tasks";

// Links between tasks (WS-134 test 1).

const UUID = "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f";

describe("task link schemas (WS-134)", () => {
  it("has the four types of doc 0003 section 7 and a limit of 100", () => {
    expect(TASK_LINK_TYPES).toEqual(["blocks", "duplicates", "regression_of", "relates_to"]);
    expect(MAX_TASK_LINKS).toBe(100);
  });

  it.each(TASK_LINK_TYPES)("takes a %s link either way, to an id or a key", (type) => {
    for (const direction of ["outgoing", "incoming"] as const) {
      for (const taskId of [UUID, "API-7"]) {
        const value = { type, direction, taskId };
        expect(taskLinkRequestSchema.parse(value)).toEqual(value);
        expect(taskLinkQuerySchema.parse(value)).toEqual(value);
      }
    }
  });

  it.each([
    ["an unknown type", { type: "parent_of", direction: "outgoing", taskId: "API-7" }],
    ["an unknown direction", { type: "blocks", direction: "both", taskId: "API-7" }],
    ["a malformed task", { type: "blocks", direction: "outgoing", taskId: "api 7" }],
    ["a missing field", { type: "blocks", direction: "outgoing" }],
    ["an extra field", { type: "blocks", direction: "outgoing", taskId: "API-7", note: "x" }],
  ])("refuses %s", (_name, value) => {
    expect(taskLinkRequestSchema.safeParse(value).success).toBe(false);
    expect(taskLinkQuerySchema.safeParse(value).success).toBe(false);
  });

  it("answers a link of each type", () => {
    for (const type of TASK_LINK_TYPES) {
      const link = { type, direction: "outgoing", task: { id: UUID, key: "API-7", title: "t" } };
      expect(taskLinkSchema.parse(link)).toEqual(link);
    }
  });

  it("registers both endpoints, which need tasks:write", () => {
    expect(contracts).toContain(addTaskLinkContract);
    expect(contracts).toContain(removeTaskLinkContract);
    for (const contract of [addTaskLinkContract, removeTaskLinkContract]) {
      expect(contract.path).toBe("/api/v1/tasks/{taskId}/links");
      expect(contract.access).toEqual({ kind: "permission", permission: "tasks:write" });
    }
    expect(Object.keys(addTaskLinkContract.responses)).toContain("200");
    expect(Object.keys(removeTaskLinkContract.responses)).toContain("204");
  });
});
