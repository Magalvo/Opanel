import { describe, expect, it } from "vitest";
import { z } from "zod";

import { contracts } from "./contracts";
import { buildOpenApiDocument } from "./document";

// WS-044: a request body is bounded, and every operation that takes one says so.
describe("the 413 of a body that is too large", () => {
  const withBody = contracts.filter((contract) => contract.request?.body !== undefined);

  it("is documented by every operation that takes a body, and by no other", () => {
    expect(withBody.length).toBeGreaterThan(10);

    const documented = contracts
      .filter((contract) => 413 in contract.responses)
      .map((contract) => `${contract.method} ${contract.path}`)
      .sort();

    expect(documented).toEqual(
      withBody.map((contract) => `${contract.method} ${contract.path}`).sort(),
    );
  });

  it("goes with the 415 of a body that is not JSON", () => {
    for (const contract of contracts) {
      expect(413 in contract.responses, `${contract.method} ${contract.path}`).toBe(
        415 in contract.responses,
      );
    }
  });

  it("is in the generated OpenAPI document, as a problem response", () => {
    const document = z
      .object({
        paths: z.record(
          z.string(),
          z.record(z.string(), z.object({ responses: z.record(z.string(), z.unknown()) })),
        ),
      })
      .parse(JSON.parse(JSON.stringify(buildOpenApiDocument())));

    expect(Object.keys(document.paths["/api/v1/auth/sign-in"]?.post?.responses ?? {})).toContain(
      "413",
    );
    expect(Object.keys(document.paths["/api/v1/tasks/{taskId}"]?.patch?.responses ?? {})).toContain(
      "413",
    );
    expect(Object.keys(document.paths["/api/v1/health"]?.get?.responses ?? {})).not.toContain(
      "413",
    );
  });
});
