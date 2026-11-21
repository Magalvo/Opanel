import { describe, expect, it } from "vitest";
import { z } from "zod";

import { agentMeSchema } from "@/lib/schemas/auth";

import { createApiClient } from "./api";
import {
  fakeFetch,
  jsonResponse,
  problemResponse,
  QA_AGENT,
  REQUEST_ID,
  TOKEN,
  URL_BASE,
} from "./testing";

// The API client and its failures (WS-099 tests 3 to 5).

function client(fetch: typeof globalThis.fetch) {
  return createApiClient({ baseUrl: URL_BASE, token: TOKEN, fetch, version: "1.2.3" });
}

describe("createApiClient", () => {
  it("sends the token, Accept and User-Agent, and parses a 200", async () => {
    const fake = fakeFetch(() => jsonResponse(200, QA_AGENT));

    const result = await client(fake.fetch).get("/me", agentMeSchema);

    expect(result).toEqual({ ok: true, value: QA_AGENT });
    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0];
    expect(call?.url).toBe(`${URL_BASE}/api/v1/me`);
    expect(call?.method).toBe("GET");
    expect(call?.headers.get("Authorization")).toBe(`Bearer ${TOKEN}`);
    expect(call?.headers.get("Accept")).toBe("application/json");
    expect(call?.headers.get("User-Agent")).toBe("opanel-mcp/1.2.3");
  });

  it("turns a problem into a failure with its status, code, detail, errors and request id", async () => {
    const errors = [{ path: "title", message: "Required" }];
    const fake = fakeFetch(() =>
      problemResponse(400, "invalid_request", "The body is not valid.", { errors }),
    );

    const result = await client(fake.fetch).get("/me", agentMeSchema);

    expect(result).toEqual({
      ok: false,
      error: {
        kind: "problem",
        status: 400,
        code: "invalid_request",
        title: "Error",
        detail: "The body is not valid.",
        errors,
        requestId: REQUEST_ID,
      },
    });
  });

  it("reports a 200 that does not match, holding none of the body", async () => {
    const fake = fakeFetch(() => jsonResponse(200, { secret: "do-not-pass-on" }));

    const result = await client(fake.fetch).get("/me", agentMeSchema);

    expect(result).toEqual({
      ok: false,
      error: { kind: "unexpected_response", status: 200, requestId: REQUEST_ID },
    });
    expect(JSON.stringify(result)).not.toContain("do-not-pass-on");
  });

  it("reports a body that is not JSON, and an error that is not a problem, as unexpected", async () => {
    const html = fakeFetch(() => new Response("<html>do-not-pass-on</html>", { status: 200 }));
    const proxy = fakeFetch(() => new Response("Bad gateway", { status: 502 }));

    expect(await client(html.fetch).get("/me", z.unknown())).toEqual({
      ok: false,
      error: { kind: "unexpected_response", status: 200, requestId: null },
    });
    expect(await client(proxy.fetch).get("/me", z.unknown())).toEqual({
      ok: false,
      error: { kind: "unexpected_response", status: 502, requestId: null },
    });
  });

  it("reports a fetch that throws as unreachable, without its message", async () => {
    const fake = fakeFetch(() => {
      throw new TypeError(`connect ECONNREFUSED, header Bearer ${TOKEN}`);
    });

    const result = await client(fake.fetch).get("/me", agentMeSchema);

    expect(result).toEqual({
      ok: false,
      error: { kind: "unreachable", message: `Opanel is unreachable at ${URL_BASE}.` },
    });
  });
});
