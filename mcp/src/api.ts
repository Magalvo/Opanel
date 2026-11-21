import type { z } from "zod";

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
    }
  | { kind: "unexpected_response"; status: number; requestId: string | null }
  | { kind: "unreachable"; message: string };

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: ToolFailure };

export interface ApiClient {
  /** `GET /api/v1<path>`, its `2xx` body parsed with `schema`. */
  get<T>(path: string, schema: z.ZodType<T>): Promise<ApiResult<T>>;
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
    return { ok: true, value: (await response.json()) };
  } catch {
    return { ok: false };
  }
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const unreachable: ToolFailure = {
    kind: "unreachable",
    message: `Opanel is unreachable at ${options.baseUrl}.`,
  };

  async function request(path: string): Promise<Response | null> {
    try {
      return await options.fetch(`${options.baseUrl}/api/v1${path}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${options.token}`,
          Accept: "application/json",
          "User-Agent": `opanel-mcp/${options.version}`,
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      // The error's message is not passed on: it can name a header or an internal address.
      return null;
    }
  }

  return {
    async get(path, schema) {
      const response = await request(path);
      if (response === null) return { ok: false, error: unreachable };

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
      const { status, code, title, detail, errors, requestId } = problem.data;
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
        },
      };
    },
  };
}
