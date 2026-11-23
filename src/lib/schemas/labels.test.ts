import { describe, expect, it } from "vitest";

import { contracts } from "@/lib/openapi/contracts";

import {
  createLabelRequestSchema,
  LABEL_COLOURS,
  labelListSchema,
  labelParamsSchema,
  labelRefSchema,
  labelSchema,
  updateLabelRequestSchema,
} from "./labels";

// Labels (WS-107 test 1).

const UUID = "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f";
const AT = "2026-11-23T08:00:00.000Z";

describe("label schemas (WS-107)", () => {
  it("has the ten colours of the palette", () => {
    expect(LABEL_COLOURS).toEqual([
      "gray",
      "red",
      "orange",
      "amber",
      "green",
      "teal",
      "blue",
      "indigo",
      "purple",
      "pink",
    ]);
  });

  it("create: a trimmed name of 1 to 40 characters, a colour of the palette, gray by default", () => {
    expect(createLabelRequestSchema.parse({ name: "  Needs design  " })).toEqual({
      name: "Needs design",
      colour: "gray",
    });
    expect(createLabelRequestSchema.parse({ name: "x".repeat(40), colour: "teal" }).colour).toBe(
      "teal",
    );
    for (const body of [
      { name: "" },
      { name: "   " },
      { name: "x".repeat(41) },
      { name: "A", colour: "black" },
      { name: "A", colour: "#ff0000" },
      { name: "A", version: 1 },
    ]) {
      expect(createLabelRequestSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });

  it("update: needs version and a name or a colour", () => {
    expect(updateLabelRequestSchema.parse({ name: " Bug ", version: 2 })).toEqual({
      name: "Bug",
      version: 2,
    });
    expect(updateLabelRequestSchema.safeParse({ colour: "red", version: 1 }).success).toBe(true);
    expect(updateLabelRequestSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(updateLabelRequestSchema.safeParse({ name: "Bug" }).success).toBe(false);
    expect(updateLabelRequestSchema.safeParse({ colour: "black", version: 1 }).success).toBe(false);
  });

  it("answers: a label, a reference to one, and the list without a cursor", () => {
    const label = {
      id: UUID,
      projectId: UUID,
      name: "Bug",
      colour: "red",
      version: 1,
      createdAt: AT,
      updatedAt: AT,
    };
    expect(labelSchema.parse(label)).toEqual(label);
    expect(labelRefSchema.parse({ id: UUID, name: "Bug", colour: "red" })).toEqual({
      id: UUID,
      name: "Bug",
      colour: "red",
    });
    expect(labelListSchema.parse({ items: [label], nextCursor: null }).items).toHaveLength(1);
    expect(labelListSchema.safeParse({ items: [], nextCursor: "x" }).success).toBe(false);
    expect(labelParamsSchema.safeParse({ labelId: UUID }).success).toBe(true);
    expect(labelParamsSchema.safeParse({ labelId: "Bug" }).success).toBe(false);
  });
});

describe("label contracts (WS-107)", () => {
  it("declare tasks:read to list, labels:write to create, labels:manage to change", () => {
    const byOperation = new Map(
      contracts.map((contract) => [`${contract.method.toUpperCase()} ${contract.path}`, contract]),
    );
    const access = (permission: string) => ({ kind: "permission", permission });

    expect(byOperation.get("GET /api/v1/projects/{projectId}/labels")?.access).toEqual(
      access("tasks:read"),
    );
    expect(byOperation.get("POST /api/v1/projects/{projectId}/labels")?.access).toEqual(
      access("labels:write"),
    );
    expect(byOperation.get("PATCH /api/v1/labels/{labelId}")?.access).toEqual(
      access("labels:manage"),
    );
    expect(byOperation.get("DELETE /api/v1/labels/{labelId}")?.access).toEqual(
      access("labels:manage"),
    );
  });
});
