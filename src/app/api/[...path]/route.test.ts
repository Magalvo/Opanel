import { describe, expect, it } from "vitest";

import { problemSchema } from "@/lib/schemas/problem";

import * as catchAll from "./route";

const context = { params: Promise.resolve({ path: ["v1", "does-not-exist"] }) };

describe("unknown API paths", () => {
  it.each(["GET", "POST", "PUT", "PATCH", "DELETE"] as const)(
    "%s returns the 404 problem body",
    async (method) => {
      const request = new Request("http://localhost/api/v1/does-not-exist", { method });

      const response = await catchAll[method](request, context);

      expect(response.status).toBe(404);
      expect(response.headers.get("Content-Type")).toBe("application/problem+json");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      const problem = problemSchema.parse(await response.json());
      expect(problem.code).toBe("not_found");
      expect(problem.requestId).toBe(response.headers.get("X-Request-Id"));
    },
  );

  it("answers HEAD with the same status", async () => {
    const request = new Request("http://localhost/api/nope", { method: "HEAD" });

    const response = await catchAll.HEAD(request, context);

    expect(response.status).toBe(404);
  });

  it("does not repeat the requested path in the body", async () => {
    const request = new Request("http://localhost/api/v1/does-not-exist");

    const response = await catchAll.GET(request, context);

    expect(await response.text()).not.toContain("does-not-exist");
  });
});
