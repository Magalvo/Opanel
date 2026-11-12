import { describe, expect, it } from "vitest";

import { ApiError } from "@/server/http/errors";

import { assertSameOrigin } from "./origin";

const appUrl = "https://opanel.example";

function request(method: string, headers: Record<string, string> = {}): Request {
  return new Request(`${appUrl}/api/v1/anything`, { method, headers });
}

function rejects(method: string, headers: Record<string, string>, app = appUrl): void {
  try {
    assertSameOrigin(request(method, headers), app);
    expect.unreachable();
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(403);
    expect((error as ApiError).code).toBe("forbidden");
  }
}

describe("assertSameOrigin", () => {
  it("lets a state-changing request from the app's own origin through", () => {
    for (const method of ["POST", "PATCH", "DELETE", "PUT"]) {
      expect(() => {
        assertSameOrigin(request(method, { Origin: appUrl }), appUrl);
      }).not.toThrow();
    }
  });

  it("compares origins only, so a path or trailing slash in APP_URL does not matter", () => {
    expect(() => {
      assertSameOrigin(request("POST", { Origin: appUrl }), "https://opanel.example/");
    }).not.toThrow();
  });

  it("rejects another origin, a look-alike, another scheme or port, null and a missing header", () => {
    rejects("POST", { Origin: "https://evil.example" });
    rejects("POST", { Origin: "https://opanel.example.evil.com" });
    rejects("POST", { Origin: "http://opanel.example" });
    rejects("POST", { Origin: "https://opanel.example:8443" });
    rejects("POST", { Origin: "null" });
    rejects("POST", {});
  });

  it("does not apply to GET and HEAD", () => {
    expect(() => {
      assertSameOrigin(request("GET", { Origin: "https://evil.example" }), appUrl);
    }).not.toThrow();
    expect(() => {
      assertSameOrigin(request("HEAD"), appUrl);
    }).not.toThrow();
  });

  it("does not apply to requests that carry an Authorization header", () => {
    expect(() => {
      assertSameOrigin(
        request("POST", { Authorization: "Bearer x", Origin: "https://evil.example" }),
        appUrl,
      );
    }).not.toThrow();
  });
});
