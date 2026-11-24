import { describe, expect, it } from "vitest";

import { activityItemSchema } from "./activity";

const createdAt = "2026-11-24T10:00:00.000Z";

describe("activityItemSchema (WS-117)", () => {
  it("reads a comment item and an event item", () => {
    const comment = {
      kind: "comment",
      comment: {
        id: "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f",
        taskId: "7c1f0e9e-2c39-4c1e-9b8e-2b6f4f1c5a01",
        kind: "user",
        author: null,
        body: "Seen",
        createdAt,
      },
    };
    const event = {
      kind: "event",
      id: "12",
      type: "field_changed",
      field: "priority",
      oldValue: "none",
      newValue: "high",
      actor: null,
      createdAt,
    };

    expect(activityItemSchema.parse(comment)).toEqual(comment);
    expect(activityItemSchema.parse(event)).toEqual(event);
  });

  it("refuses an unknown kind and a commented event", () => {
    expect(activityItemSchema.safeParse({ kind: "other" }).success).toBe(false);
    expect(
      activityItemSchema.safeParse({
        kind: "event",
        id: "1",
        type: "commented",
        field: null,
        oldValue: null,
        newValue: null,
        actor: null,
        createdAt,
      }).success,
    ).toBe(false);
  });
});
