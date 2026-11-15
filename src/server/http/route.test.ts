import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { EndpointContract } from "@/lib/openapi/contract";
import { problemSchema } from "@/lib/schemas/problem";

import { ApiError, notFound, rateLimited, versionConflict } from "./errors";
import {
  json,
  MAX_JSON_BODY_BYTES,
  noContent,
  readJson,
  readParams,
  readQuery,
  route,
  unknownPathRoute,
} from "./route";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const URL_BASE = "http://localhost/api/v1/things";
const APP_URL = "http://localhost";

/** A public operation: the wrapper checks only the origin, never credentials. */
const publicThing = {
  method: "get",
  path: "/api/v1/things",
  summary: "Things",
  access: { kind: "public" },
  responses: { 200: { description: "Things.", noContent: true } },
} satisfies EndpointContract;

function get(headers?: Record<string, string>): Request {
  return new Request(URL_BASE, headers ? { headers } : {});
}

function post(body: string, contentType: string | null = "application/json"): Request {
  return new Request(URL_BASE, {
    method: "POST",
    body,
    headers: {
      Origin: APP_URL,
      ...(contentType === null ? {} : { "Content-Type": contentType }),
    },
  });
}

async function problemOf(response: Response): Promise<z.infer<typeof problemSchema>> {
  return problemSchema.parse(await response.json());
}

/** Runs `action` inside a wrapped handler and returns the resulting response. */
async function throughRoute(
  request: Request,
  action: (request: Request) => Promise<unknown>,
): Promise<Response> {
  const handler = route(publicThing, async (incoming: Request) => json(await action(incoming)), {
    logError: () => undefined,
    appUrl: APP_URL,
  });
  return handler(request, undefined);
}

const thingSchema = z.strictObject({
  title: z.string().min(1),
  evidence: z.strictObject({ http: z.strictObject({ status: z.int() }) }).optional(),
});

describe("route", () => {
  it("turns a thrown ApiError into its problem response", async () => {
    const handler = route(publicThing, () => {
      throw notFound("No such thing.");
    });

    const response = await handler(get(), undefined);

    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toBe("application/problem+json");
    expect(await problemOf(response)).toMatchObject({
      type: "about:blank",
      title: "Not Found",
      status: 404,
      code: "not_found",
      detail: "No such thing.",
    });
  });

  it("sends Retry-After with a rate limit", async () => {
    const handler = route(publicThing, () => {
      throw rateLimited(30);
    });

    const response = await handler(get(), undefined);

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("30");
  });

  it("turns an unexpected exception into internal_error without leaking it", async () => {
    const handler = route(
      publicThing,
      () => {
        throw new Error("secret detail at /srv/app/db.ts");
      },
      { logError: () => undefined },
    );

    const response = await handler(get(), undefined);
    const text = await response.clone().text();

    expect(response.status).toBe(500);
    expect(await problemOf(response)).toMatchObject({ code: "internal_error", status: 500 });
    expect(text).not.toContain("secret detail");
    expect(text).not.toContain("db.ts");
    expect(text).not.toContain("stack");
  });

  it("logs an unexpected exception with the request id of the response", async () => {
    const logError = vi.fn<(message: string) => void>();
    const handler = route(
      publicThing,
      () => {
        throw new TypeError("boom");
      },
      { logError },
    );

    const response = await handler(get(), undefined);
    const requestId = response.headers.get("X-Request-Id") ?? "missing";

    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError.mock.calls[0]?.[0]).toContain(requestId);
    expect(logError.mock.calls[0]?.[0]).toContain("TypeError: boom");
  });

  it("does not log expected API errors", async () => {
    const logError = vi.fn<(message: string) => void>();
    const handler = route(
      publicThing,
      () => {
        throw notFound();
      },
      { logError },
    );

    await handler(get(), undefined);

    expect(logError).not.toHaveBeenCalled();
  });

  it("adds no-store and a request id to a successful response, keeping the rest", async () => {
    const handler = route(publicThing, () => json({ ok: true }, 201));

    const response = await handler(get(), undefined);

    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Request-Id")).toMatch(UUID);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(await response.json()).toEqual({ ok: true });
  });

  it("handles a response with no body", async () => {
    const handler = route(publicThing, () => noContent());

    const response = await handler(get(), undefined);

    expect(response.status).toBe(204);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Request-Id")).toMatch(UUID);
    expect(await response.text()).toBe("");
  });

  it("repeats the request id header in the error body", async () => {
    const handler = route(publicThing, () => {
      throw notFound();
    });

    const response = await handler(get(), undefined);

    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect((await problemOf(response)).requestId).toBe(response.headers.get("X-Request-Id"));
  });

  it("generates a new id per request and ignores an incoming X-Request-Id", async () => {
    const handler = route(publicThing, () => noContent());
    const supplied = "11111111-1111-4111-8111-111111111111";

    const first = await handler(get({ "X-Request-Id": supplied }), undefined);
    const second = await handler(get({ "X-Request-Id": supplied }), undefined);

    expect(first.headers.get("X-Request-Id")).toMatch(UUID);
    expect(first.headers.get("X-Request-Id")).not.toBe(supplied);
    expect(first.headers.get("X-Request-Id")).not.toBe(second.headers.get("X-Request-Id"));
  });

  it("passes the request and the route context to the handler", async () => {
    const context = { params: Promise.resolve({ id: "abc" }) };
    const handler = route(publicThing, async (request: Request, received: typeof context) =>
      json({ method: request.method, id: (await received.params).id }),
    );

    const response = await handler(get(), context);

    expect(await response.json()).toEqual({ method: "GET", id: "abc" });
  });
});

describe("route and version conflicts (WS-027)", () => {
  it("sends the current entity in the problem body, and no current on other problems", async () => {
    const current = { id: "x", name: "Board", version: 4 };
    const conflicting = route(publicThing, () => {
      throw versionConflict(current);
    });
    const missing = route(publicThing, () => {
      throw notFound();
    });

    const response = await conflicting(get(), undefined);
    const other = await missing(get(), undefined);

    expect(response.status).toBe(409);
    const body = problemSchema.parse(await response.json());
    expect(body).toMatchObject({ code: "version_conflict", current });
    expect(Object.keys(problemSchema.parse(await other.json()))).not.toContain("current");
  });
});

describe("route with a public contract", () => {
  const options = { appUrl: APP_URL, logError: () => undefined };

  function postFrom(origin: string | null): Request {
    return new Request(URL_BASE, {
      method: "POST",
      headers: origin === null ? {} : { Origin: origin },
    });
  }

  it("rejects a state-changing request from another origin, or with none, before the handler", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      for (const origin of ["https://evil.example", null]) {
        const handler = vi.fn(() => noContent());
        const request = new Request(URL_BASE, {
          method,
          headers: origin === null ? {} : { Origin: origin },
        });

        const response = await route(publicThing, handler, options)(request, undefined);

        expect(response.status, `${method} from ${String(origin)}`).toBe(403);
        expect((await problemOf(response)).code).toBe("forbidden");
        expect(handler).not.toHaveBeenCalled();
      }
    }
  });

  it("lets a same-origin state-changing request reach the handler", async () => {
    const handler = vi.fn(() => noContent());

    const response = await route(publicThing, handler, options)(postFrom(APP_URL), undefined);

    expect(response.status).toBe(204);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("needs no Origin on GET, and hands the handler no authentication", async () => {
    const received: unknown[] = [];
    const handler = vi.fn((_request: Request, _context: unknown, auth: undefined) => {
      received.push(auth);
      return json({ ok: true });
    });

    const response = await route(publicThing, handler, options)(get(), undefined);

    expect(response.status).toBe(200);
    expect(received).toEqual([undefined]);
  });

  it("exposes the contract it was built from", () => {
    const handler = route(publicThing, () => noContent(), options);

    expect(handler.contract).toBe(publicThing);
  });
});

describe("unknownPathRoute", () => {
  it("converts errors and adds the shared headers, and carries no contract", async () => {
    const handler = unknownPathRoute(() => {
      throw notFound("Nothing here.");
    });

    const response = await handler(postFrom404(), undefined);

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Request-Id")).toMatch(UUID);
    expect("contract" in handler).toBe(false);
  });

  function postFrom404(): Request {
    // No Origin: the catch-all changes nothing, so it is not checked.
    return new Request(URL_BASE, { method: "POST" });
  }
});

describe("readJson", () => {
  it("returns the typed, validated body", async () => {
    const response = await throughRoute(post('{"title":"A"}'), (request) =>
      readJson(request, thingSchema),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ title: "A" });
  });

  it("accepts a JSON content type with a charset", async () => {
    const response = await throughRoute(
      post('{"title":"A"}', "application/json; charset=utf-8"),
      (request) => readJson(request, thingSchema),
    );

    expect(response.status).toBe(200);
  });

  it("rejects malformed JSON with invalid_request", async () => {
    const response = await throughRoute(post('{"title":'), (request) =>
      readJson(request, thingSchema),
    );

    expect(response.status).toBe(400);
    const problem = await problemOf(response);
    expect(problem.code).toBe("invalid_request");
    expect(problem.errors).toBeUndefined();
  });

  it("reports one entry per failing field, with dotted paths", async () => {
    const response = await throughRoute(
      post(JSON.stringify({ title: "", evidence: { http: { status: "500" } } })),
      (request) => readJson(request, thingSchema),
    );

    expect(response.status).toBe(400);
    const problem = await problemOf(response);
    expect(problem.code).toBe("invalid_request");
    expect(problem.errors?.map((error) => error.path).sort()).toEqual([
      "evidence.http.status",
      "title",
    ]);
    for (const error of problem.errors ?? []) {
      expect(error.message.length).toBeGreaterThan(0);
    }
  });

  it("reports each unknown field by name", async () => {
    const response = await throughRoute(
      post(JSON.stringify({ title: "A", titel: "B", evidence: { http: { status: 1, x: 2 } } })),
      (request) => readJson(request, thingSchema),
    );

    const problem = await problemOf(response);
    expect(problem.errors?.map((error) => error.path).sort()).toEqual(["evidence.http.x", "titel"]);
  });

  it("reports a body of the wrong shape at the root", async () => {
    const response = await throughRoute(post("[1,2]"), (request) => readJson(request, thingSchema));

    const problem = await problemOf(response);
    expect(problem.errors).toHaveLength(1);
    expect(problem.errors?.[0]?.path).toBe("");
  });

  // Field names are reported (see above); the values sent for them never are.
  it("never echoes a rejected value", async () => {
    const marker = "MARKER-hunter2-MARKER";
    const response = await throughRoute(
      post(
        JSON.stringify({
          title: 12345678,
          extra: marker,
          kind: marker,
          evidence: { http: { status: marker } },
        }),
      ),
      (request) => readJson(request, z.strictObject({ ...thingSchema.shape, kind: z.enum(["a"]) })),
    );
    const text = await response.text();

    expect(response.status).toBe(400);
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("12345678");
  });

  it.each([["text/plain"], ["application/x-www-form-urlencoded"], [null]])(
    "rejects content type %s with 415",
    async (contentType) => {
      const response = await throughRoute(post('{"title":"A"}', contentType), (request) =>
        readJson(request, thingSchema),
      );

      expect(response.status).toBe(415);
      expect((await problemOf(response)).code).toBe("unsupported_media_type");
    },
  );
});

describe("readQuery", () => {
  const querySchema = z.strictObject({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).optional(),
    label: z.array(z.string()).optional(),
  });

  function withQuery(query: string): Request {
    return new Request(`${URL_BASE}${query}`);
  }

  it("returns typed values and applies defaults", async () => {
    const response = await throughRoute(withQuery("?cursor=abc"), (request) =>
      Promise.resolve(readQuery(request, querySchema)),
    );

    expect(await response.json()).toEqual({ limit: 50, cursor: "abc" });
  });

  it("gives a repeated parameter as a list", async () => {
    const response = await throughRoute(withQuery("?label=a&label=b&limit=10"), (request) =>
      Promise.resolve(readQuery(request, querySchema)),
    );

    expect(await response.json()).toEqual({ limit: 10, label: ["a", "b"] });
  });

  it("rejects invalid and unknown parameters with their names", async () => {
    const response = await throughRoute(withQuery("?limit=500&page=2"), (request) =>
      Promise.resolve(readQuery(request, querySchema)),
    );

    expect(response.status).toBe(400);
    const problem = await problemOf(response);
    expect(problem.code).toBe("invalid_request");
    expect(problem.errors?.map((error) => error.path).sort()).toEqual(["limit", "page"]);
  });
});

describe("readParams", () => {
  const paramsSchema = z.strictObject({ projectId: z.uuid() });
  const projectId = "0193a1c2-7b6a-7c3e-8f10-2a4b6c8d0e1f";

  it("awaits and returns typed path parameters", async () => {
    const response = await throughRoute(get(), () =>
      readParams(Promise.resolve({ projectId }), paramsSchema),
    );

    expect(await response.json()).toEqual({ projectId });
  });

  it("rejects an invalid path parameter with its name", async () => {
    const response = await throughRoute(get(), () =>
      readParams(Promise.resolve({ projectId: "42" }), paramsSchema),
    );

    expect(response.status).toBe(400);
    expect((await problemOf(response)).errors?.map((error) => error.path)).toEqual(["projectId"]);
  });
});

describe("ApiError outside the wrapper", () => {
  it("is what the helpers throw", () => {
    expect(() => readQuery(new Request(`${URL_BASE}?x=1`), z.strictObject({}))).toThrow(ApiError);
  });
});

// WS-044: a body is read with a budget of bytes, counted as it arrives.
describe("readJson: the size of the body", () => {
  const CHUNK = 64 * 1024;

  /** `{"title":"aaa…"}` of exactly this many bytes. */
  function bodyOfBytes(bytes: number): string {
    const frame = new TextEncoder().encode('{"title":""}').length;
    return `{"title":"${"a".repeat(bytes - frame)}"}`;
  }

  /** A request whose body is a stream the test can watch: how much was pulled, and whether it was cancelled. */
  function streamed(
    options: { chunks: number; failAfter?: number; headers?: Record<string, string> } = {
      chunks: 0,
    },
  ) {
    const watch = { pulled: 0, cancelled: false };
    const chunk = new TextEncoder().encode(`${"a".repeat(CHUNK - 1)}\n`);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (options.failAfter !== undefined && watch.pulled >= options.failAfter) {
          controller.error(new Error("connection lost"));
          return;
        }
        if (watch.pulled >= options.chunks) {
          controller.close();
          return;
        }
        watch.pulled += 1;
        controller.enqueue(chunk);
      },
      cancel() {
        watch.cancelled = true;
      },
    });
    const request = new Request(URL_BASE, {
      method: "POST",
      body: stream,
      duplex: "half",
      headers: { Origin: APP_URL, "Content-Type": "application/json", ...options.headers },
    } as RequestInit);
    return { request, watch };
  }

  async function statusOf(request: Request): Promise<number> {
    return (await throughRoute(request, (incoming) => readJson(incoming, thingSchema))).status;
  }

  it("has a budget of 512 KiB", () => {
    expect(MAX_JSON_BODY_BYTES).toBe(512 * 1024);
  });

  it("accepts a body of exactly the budget and refuses one byte more with 413", async () => {
    expect(await statusOf(post(bodyOfBytes(MAX_JSON_BODY_BYTES)))).toBe(200);

    const response = await throughRoute(post(bodyOfBytes(MAX_JSON_BODY_BYTES + 1)), (request) =>
      readJson(request, thingSchema),
    );

    expect(response.status).toBe(413);
    const problem = await problemOf(response);
    expect(problem).toMatchObject({ code: "payload_too_large", status: 413 });
    expect(problem.detail).toBe("The request body is too large.");
    expect(JSON.stringify(problem)).not.toContain("524288");
  });

  it("refuses a Content-Length over the budget without reading the body", async () => {
    const { request, watch } = streamed({
      chunks: 4,
      headers: { "Content-Length": String(MAX_JSON_BODY_BYTES + 1) },
    });

    expect(await statusOf(request)).toBe(413);
    expect(watch.pulled).toBe(0);
  });

  it("counts a body that declares no length, and cancels the stream soon after the budget", async () => {
    const { request, watch } = streamed({ chunks: 80 });

    expect(await statusOf(request)).toBe(413);
    expect(watch.cancelled).toBe(true);
    // The budget is eight chunks; the stream is never read to its end.
    expect(watch.pulled).toBeLessThan(20);
  });

  it("does not trust a Content-Length that says the body is small", async () => {
    const { request, watch } = streamed({ chunks: 80, headers: { "Content-Length": "10" } });

    expect(await statusOf(request)).toBe(413);
    expect(watch.cancelled).toBe(true);
  });

  it("ignores a malformed Content-Length: a small body passes, a large one is refused", async () => {
    for (const header of ["abc", "-1", "1e9", ""]) {
      const small = new Request(URL_BASE, {
        method: "POST",
        body: '{"title":"A"}',
        headers: { Origin: APP_URL, "Content-Type": "application/json", "Content-Length": header },
      });
      expect(await statusOf(small), header).toBe(200);
      const { request } = streamed({ chunks: 80, headers: { "Content-Length": header } });
      expect(await statusOf(request), header).toBe(413);
    }
  });

  it("counts bytes, not characters: 200 000 three-byte characters are over the budget", async () => {
    const text = JSON.stringify({ title: "€".repeat(200_000) });
    expect(text.length).toBeLessThan(MAX_JSON_BODY_BYTES);

    expect(await statusOf(post(text))).toBe(413);
  });

  it("keeps the 415 first, and 400 for malformed JSON within the budget", async () => {
    expect(await statusOf(post(bodyOfBytes(MAX_JSON_BODY_BYTES + 1), "text/plain"))).toBe(415);

    const response = await throughRoute(post('{"title":'), (request) =>
      readJson(request, thingSchema),
    );

    expect(response.status).toBe(400);
    expect((await problemOf(response)).detail).toBe("The request body is not valid JSON.");
  });

  it("answers 400, not 500, when the body stops arriving half way", async () => {
    const { request } = streamed({ chunks: 4, failAfter: 2 });

    const response = await throughRoute(request, (incoming) => readJson(incoming, thingSchema));

    expect(response.status).toBe(400);
    expect((await problemOf(response)).code).toBe("invalid_request");
  });

  it("parses as request.json() does: a byte order mark and multibyte text", async () => {
    const bytes = new TextEncoder().encode('\uFEFF{"title":"héllo € 日本"}');
    const request = new Request(URL_BASE, {
      method: "POST",
      body: bytes,
      headers: { Origin: APP_URL, "Content-Type": "application/json" },
    });

    const response = await throughRoute(request, (incoming) => readJson(incoming, thingSchema));

    expect(await response.json()).toEqual({ title: "héllo € 日本" });
  });
});
