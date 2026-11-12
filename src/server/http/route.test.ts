import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { problemSchema } from "@/lib/schemas/problem";

import { ApiError, notFound, rateLimited } from "./errors";
import { json, noContent, readJson, readParams, readQuery, route } from "./route";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const URL_BASE = "http://localhost/api/v1/things";

function get(headers?: Record<string, string>): Request {
  return new Request(URL_BASE, headers ? { headers } : {});
}

function post(body: string, contentType: string | null = "application/json"): Request {
  return new Request(URL_BASE, {
    method: "POST",
    body,
    headers: contentType === null ? {} : { "Content-Type": contentType },
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
  const handler = route(async (incoming: Request) => json(await action(incoming)), {
    logError: () => undefined,
  });
  return handler(request, undefined);
}

const thingSchema = z.strictObject({
  title: z.string().min(1),
  evidence: z.strictObject({ http: z.strictObject({ status: z.int() }) }).optional(),
});

describe("route", () => {
  it("turns a thrown ApiError into its problem response", async () => {
    const handler = route(() => {
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
    const handler = route(() => {
      throw rateLimited(30);
    });

    const response = await handler(get(), undefined);

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("30");
  });

  it("turns an unexpected exception into internal_error without leaking it", async () => {
    const handler = route(
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
      () => {
        throw notFound();
      },
      { logError },
    );

    await handler(get(), undefined);

    expect(logError).not.toHaveBeenCalled();
  });

  it("adds no-store and a request id to a successful response, keeping the rest", async () => {
    const handler = route(() => json({ ok: true }, 201));

    const response = await handler(get(), undefined);

    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Request-Id")).toMatch(UUID);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(await response.json()).toEqual({ ok: true });
  });

  it("handles a response with no body", async () => {
    const handler = route(() => noContent());

    const response = await handler(get(), undefined);

    expect(response.status).toBe(204);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Request-Id")).toMatch(UUID);
    expect(await response.text()).toBe("");
  });

  it("repeats the request id header in the error body", async () => {
    const handler = route(() => {
      throw notFound();
    });

    const response = await handler(get(), undefined);

    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect((await problemOf(response)).requestId).toBe(response.headers.get("X-Request-Id"));
  });

  it("generates a new id per request and ignores an incoming X-Request-Id", async () => {
    const handler = route(() => noContent());
    const supplied = "11111111-1111-4111-8111-111111111111";

    const first = await handler(get({ "X-Request-Id": supplied }), undefined);
    const second = await handler(get({ "X-Request-Id": supplied }), undefined);

    expect(first.headers.get("X-Request-Id")).toMatch(UUID);
    expect(first.headers.get("X-Request-Id")).not.toBe(supplied);
    expect(first.headers.get("X-Request-Id")).not.toBe(second.headers.get("X-Request-Id"));
  });

  it("passes the request and the route context to the handler", async () => {
    const context = { params: Promise.resolve({ id: "abc" }) };
    const handler = route(
      async (request: Request, received: typeof context) =>
        json({ method: request.method, id: (await received.params).id }),
    );

    const response = await handler(get(), context);

    expect(await response.json()).toEqual({ method: "GET", id: "abc" });
  });
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
    expect(problem.errors?.map((error) => error.path).sort()).toEqual([
      "evidence.http.x",
      "titel",
    ]);
  });

  it("reports a body of the wrong shape at the root", async () => {
    const response = await throughRoute(post("[1,2]"), (request) =>
      readJson(request, thingSchema),
    );

    const problem = await problemOf(response);
    expect(problem.errors).toHaveLength(1);
    expect(problem.errors?.[0]?.path).toBe("");
  });

  it("never echoes a rejected value", async () => {
    const marker = "MARKER-hunter2-MARKER";
    const response = await throughRoute(
      post(
        JSON.stringify({
          title: 12345678,
          [marker]: marker,
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
