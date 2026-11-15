import { describe, expect, it } from "vitest";

import { contracts } from "@/lib/openapi/contracts";

import { commentKindSchema, commentQuerySchema, createCommentRequestSchema } from "./comments";

function paths(result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) {
  return result.error?.issues.map((issue) => issue.path.join(".")) ?? [];
}

describe("comment requests", () => {
  it("keeps the body exactly as written", () => {
    expect(createCommentRequestSchema.parse({ body: "  **Fixed** in OPA-2\n" })).toEqual({
      body: "  **Fixed** in OPA-2\n",
    });
  });

  it("refuses an empty or whitespace-only body, on body", () => {
    for (const body of ["", "   ", "\n\t "]) {
      const result = createCommentRequestSchema.safeParse({ body });
      expect(result.success, JSON.stringify(body)).toBe(false);
      expect(paths(result)).toEqual(["body"]);
    }
  });

  it("accepts 10 000 characters and refuses 10 001", () => {
    expect(createCommentRequestSchema.safeParse({ body: "x".repeat(10_000) }).success).toBe(true);
    expect(paths(createCommentRequestSchema.safeParse({ body: "x".repeat(10_001) }))).toEqual([
      "body",
    ]);
  });

  it("refuses unknown fields such as kind or author, and a missing body", () => {
    expect(createCommentRequestSchema.safeParse({ body: "Hi", kind: "system" }).success).toBe(
      false,
    );
    expect(createCommentRequestSchema.safeParse({ body: "Hi", authorId: "x" }).success).toBe(false);
    expect(createCommentRequestSchema.safeParse({}).success).toBe(false);
  });

  it("has the kinds user and system", () => {
    expect(commentKindSchema.options).toEqual(["user", "system"]);
  });

  it("paginates the list", () => {
    expect(commentQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(commentQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
  });
});

describe("comment contracts", () => {
  it("list with tasks:read and create with comments:write, with the documented responses", () => {
    const byKey = new Map(
      contracts.map((contract) => [`${contract.method.toUpperCase()} ${contract.path}`, contract]),
    );
    const list = byKey.get("GET /api/v1/tasks/{taskId}/comments");
    const create = byKey.get("POST /api/v1/tasks/{taskId}/comments");

    expect(list?.access).toEqual({ kind: "permission", permission: "tasks:read" });
    expect(create?.access).toEqual({ kind: "permission", permission: "comments:write" });
    expect(Object.keys(list?.responses ?? {}).sort()).toEqual(["200", "400", "404"]);
    expect(Object.keys(create?.responses ?? {}).sort()).toEqual([
      "201",
      "400",
      "404",
      "409",
      "415",
    ]);
  });
});
