import { describe, expect, it } from "vitest";

import { contracts } from "@/lib/openapi/contracts";

import {
  commentPageSchema,
  commentSchema,
  createCommentContract,
  createCommentRequestSchema,
  listCommentsContract,
} from "./comments";

const UUID = "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f";

describe("createCommentRequestSchema", () => {
  it("accepts 1 to 10 000 characters and keeps the body exactly as written", () => {
    const body = "  # Heading\n\nSome *Markdown*  \n";
    expect(createCommentRequestSchema.parse({ body })).toEqual({ body });
    expect(createCommentRequestSchema.safeParse({ body: "x" }).success).toBe(true);
    expect(createCommentRequestSchema.safeParse({ body: "x".repeat(10_000) }).success).toBe(true);
  });

  it("refuses an empty, blank or too long body, and unknown fields", () => {
    for (const body of [
      {},
      { body: "" },
      { body: "   \n\t " },
      { body: "x".repeat(10_001) },
      { body: 12 },
      { body: "ok", authorId: UUID },
      { body: "ok", kind: "system" },
    ]) {
      expect(createCommentRequestSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });

  it("names the field of a blank body", () => {
    const result = createCommentRequestSchema.safeParse({ body: "  " });

    expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual(["body"]);
  });
});

describe("comment responses", () => {
  const comment = {
    id: UUID,
    taskId: UUID,
    kind: "user",
    author: { id: UUID, name: "Mia" },
    body: "Hello",
    createdAt: "2026-11-14T10:00:00.000Z",
  };

  it("describe a comment and a page of comments", () => {
    expect(commentSchema.parse(comment)).toEqual(comment);
    expect(commentSchema.parse({ ...comment, author: null }).author).toBeNull();
    expect(commentPageSchema.parse({ items: [comment], nextCursor: null }).items).toHaveLength(1);
  });

  it("refuse a kind other than user and unknown fields", () => {
    expect(commentSchema.safeParse({ ...comment, kind: "system" }).success).toBe(false);
    expect(commentSchema.safeParse({ ...comment, version: 1 }).success).toBe(false);
  });
});

describe("comment contracts", () => {
  it("read with tasks:read and write with comments:write", () => {
    const access = new Map(
      contracts.map((contract) => [
        `${contract.method.toUpperCase()} ${contract.path}`,
        contract.access,
      ]),
    );

    expect(access.get("GET /api/v1/tasks/{taskId}/comments")).toEqual({
      kind: "permission",
      permission: "tasks:read",
    });
    expect(access.get("POST /api/v1/tasks/{taskId}/comments")).toEqual({
      kind: "permission",
      permission: "comments:write",
    });
  });

  it("document their errors", () => {
    expect(Object.keys(listCommentsContract.responses).map(Number)).toEqual(
      expect.arrayContaining([200, 400, 404]),
    );
    expect(Object.keys(createCommentContract.responses).map(Number)).toEqual(
      expect.arrayContaining([201, 400, 404, 409, 415]),
    );
  });
});
