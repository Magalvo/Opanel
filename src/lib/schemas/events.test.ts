import { describe, expect, it } from "vitest";

import { EVENTS_CHANNEL, PROJECT_EVENT_TYPES, projectEventSchema } from "./events";

const PROJECT = "0193a1b7-0000-4000-8000-000000000001";
const ENTITY = "0193a1b7-0000-4000-8000-000000000002";
const TASK = "0193a1b7-0000-4000-8000-000000000003";
const ACTOR = "0193a1b7-0000-4000-8000-000000000004";

const common = {
  id: "0193a1c2-0000-4000-8000-000000000005",
  projectId: PROJECT,
  entityId: ENTITY,
  actorAccountId: ACTOR,
  at: "2026-11-17T10:00:00.000Z",
};

const examples = {
  "task.created": { ...common, type: "task.created", entity: "task", version: 1 },
  "task.updated": { ...common, type: "task.updated", entity: "task", version: 2 },
  "task.moved": { ...common, type: "task.moved", entity: "task", version: 3 },
  "task.deleted": { ...common, type: "task.deleted", entity: "task", version: 4 },
  "task.restored": { ...common, type: "task.restored", entity: "task", version: 5 },
  "comment.created": {
    ...common,
    type: "comment.created",
    entity: "comment",
    version: null,
    taskId: TASK,
  },
  "column.changed": { ...common, type: "column.changed", entity: "column", version: 2 },
  "epic.changed": { ...common, type: "epic.changed", entity: "epic", version: 1 },
  "label.changed": { ...common, type: "label.changed", entity: "label", version: 1 },
  "sprint.changed": { ...common, type: "sprint.changed", entity: "sprint", version: 1 },
  "project.changed": {
    ...common,
    type: "project.changed",
    entity: "project",
    entityId: PROJECT,
    version: 3,
  },
} as const;

describe("projectEventSchema (WS-045)", () => {
  it("lists exactly the event types of WT-04 decision 1 and WS-107", () => {
    expect([...PROJECT_EVENT_TYPES].sort()).toEqual(Object.keys(examples).sort());
  });

  it("uses one channel for every event", () => {
    expect(EVENTS_CHANNEL).toBe("opanel_events");
  });

  it.each(Object.entries(examples))("accepts a valid %s", (_type, event) => {
    expect(projectEventSchema.parse(event)).toEqual(event);
  });

  it("accepts a deleted sprint, whose version is null (WS-140)", () => {
    const deleted = { ...examples["sprint.changed"], version: null };

    expect(projectEventSchema.parse(deleted)).toEqual(deleted);
  });

  it("accepts a deleted label, whose version is null (WS-107)", () => {
    const deleted = { ...examples["label.changed"], version: null };

    expect(projectEventSchema.parse(deleted)).toEqual(deleted);
  });

  it("accepts a deleted column, whose version is null", () => {
    const deleted = { ...examples["column.changed"], version: null };

    expect(projectEventSchema.parse(deleted)).toEqual(deleted);
  });

  it.each([
    ["a task event with another entity", { ...examples["task.updated"], entity: "epic" }],
    ["comment.created without taskId", { ...examples["comment.created"], taskId: undefined }],
    ["taskId on another type", { ...examples["task.created"], taskId: TASK }],
    ["a null version on a task event", { ...examples["task.moved"], version: null }],
    ["a null version on an epic event", { ...examples["epic.changed"], version: null }],
    ["a null version on a project event", { ...examples["project.changed"], version: null }],
    ["a version on a comment event", { ...examples["comment.created"], version: 1 }],
    ["a version of zero", { ...examples["task.created"], version: 0 }],
    ["an unknown field", { ...examples["task.created"], title: "Leaked" }],
    ["an unknown type", { ...examples["task.created"], type: "task.archived" }],
    ["an id that is not a UUID", { ...examples["task.created"], entityId: "OPA-1" }],
    ["a time that is not ISO 8601 UTC", { ...examples["task.created"], at: "yesterday" }],
    ["a project event about another project", { ...examples["project.changed"], entityId: ENTITY }],
  ])("refuses %s", (_case, event) => {
    expect(projectEventSchema.safeParse(event).success).toBe(false);
  });

  it("keeps every event far below the 8 000-byte payload limit of NOTIFY", () => {
    const largest = JSON.stringify(examples["comment.created"]);

    expect(new TextEncoder().encode(largest).length).toBeLessThan(1000);
  });
});
