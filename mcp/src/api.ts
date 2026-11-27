import { z } from "zod";

import { type FieldError, problemSchema } from "@/lib/schemas/problem";

// The client of /api/v1 the tools use (WS-099). It never throws for an HTTP or network
// failure: it answers a `ToolFailure`, which a tool turns into a tool error.

/** Why a request did not give the expected answer. Never holds a response body. */
export type ToolFailure =
  | {
      kind: "problem";
      status: number;
      code: string;
      title: string;
      detail: string;
      errors?: FieldError[];
      requestId: string;
      /** Only with `version_conflict`: the entity as it is now, not yet parsed (WS-104). */
      current?: unknown;
    }
  | { kind: "unexpected_response"; status: number; requestId: string | null }
  | { kind: "unreachable"; message: string };

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: ToolFailure };

export interface ApiClient {
  /** `GET /api/v1<path>`, its `2xx` body parsed with `schema`. */
  get<T>(path: string, schema: z.ZodType<T>): Promise<ApiResult<T>>;
  /**
   * A write (WS-104): `body` as JSON to `/api/v1<path>`, its `2xx` body parsed with `schema`.
   * Sent once, never retried: a write that got no answer may still have been made.
   */
  send<T>(
    method: "POST" | "PATCH",
    path: string,
    body: unknown,
    schema: z.ZodType<T>,
  ): Promise<ApiResult<T>>;
  /**
   * `DELETE /api/v1<path>`, answering `null` on a `204` (WS-137). Sent once, never retried,
   * as `send` is.
   */
  remove(path: string): Promise<ApiResult<null>>;
}

export interface ApiClientOptions {
  baseUrl: string;
  token: string;
  fetch: typeof fetch;
  /** The package's version, sent in `User-Agent`. */
  version: string;
}

const TIMEOUT_MS = 30_000;

async function readJson(response: Response): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: await response.json() };
  } catch {
    return { ok: false };
  }
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const unreachable: ToolFailure = {
    kind: "unreachable",
    message: `Opanel is unreachable at ${options.baseUrl}.`,
  };

  const unanswered: ToolFailure = {
    kind: "unreachable",
    message:
      `Opanel did not answer at ${options.baseUrl}, so the change may have been made. ` +
      "Read the task with opanel_get_task before trying again.",
  };

  async function request(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<Response | null> {
    try {
      return await options.fetch(`${options.baseUrl}/api/v1${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${options.token}`,
          Accept: "application/json",
          "User-Agent": `opanel-mcp/${options.version}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      // The error's message is not passed on: it can name a header or an internal address.
      return null;
    }
  }

  async function answer<T>(response: Response, schema: z.ZodType<T>): Promise<ApiResult<T>> {
    const header = response.headers.get("X-Request-Id");
    const body = await readJson(response);
    const unexpected: ToolFailure = {
      kind: "unexpected_response",
      status: response.status,
      requestId: body.ok ? header : null,
    };

    if (response.ok) {
      const parsed = body.ok ? schema.safeParse(body.value) : null;
      return parsed?.success === true
        ? { ok: true, value: parsed.data }
        : { ok: false, error: unexpected };
    }

    const problem = body.ok ? problemSchema.safeParse(body.value) : null;
    if (problem?.success !== true) return { ok: false, error: unexpected };
    const { status, code, title, detail, errors, requestId, current } = problem.data;
    return {
      ok: false,
      error: {
        kind: "problem",
        status,
        code,
        title,
        detail,
        ...(errors === undefined ? {} : { errors }),
        requestId,
        ...(code === "version_conflict" && current !== undefined ? { current } : {}),
      },
    };
  }

  return {
    async get(path, schema) {
      const response = await request("GET", path);
      return response === null ? { ok: false, error: unreachable } : answer(response, schema);
    },
    async send(method, path, body, schema) {
      const response = await request(method, path, body);
      return response === null ? { ok: false, error: unanswered } : answer(response, schema);
    },
    async remove(path) {
      const response = await request("DELETE", path);
      if (response === null) return { ok: false, error: unanswered };
      if (response.status === 204) return { ok: true, value: null };
      return answer(response, z.null());
    },
  };
}
