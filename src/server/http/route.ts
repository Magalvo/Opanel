import type { z } from "zod";

import { type FieldError, type Problem, PROBLEM_CONTENT_TYPE } from "@/lib/schemas/problem";

import { ApiError, internalError, invalidRequest, unsupportedMediaType } from "./errors";

export type RouteHandler<Context> = (
  request: Request,
  context: Context,
) => Response | Promise<Response>;

export interface RouteOptions {
  /** Receives a description of an unexpected failure. Never part of the response. */
  logError?: (message: string) => void;
}

function problemResponse(error: ApiError, requestId: string): Response {
  const problem: Problem = {
    type: "about:blank",
    title: error.title,
    status: error.status,
    code: error.code,
    detail: error.detail,
    requestId,
    ...(error.errors === undefined ? {} : { errors: [...error.errors] }),
  };
  const headers = new Headers({ "Content-Type": PROBLEM_CONTENT_TYPE });
  if (error.retryAfterSeconds !== undefined) {
    headers.set("Retry-After", String(error.retryAfterSeconds));
  }
  return new Response(JSON.stringify(problem), { status: error.status, headers });
}

/**
 * Wraps a route handler with the behaviour every API endpoint shares (canonical doc
 * 0004): a request id, `Cache-Control: no-store`, and the conversion of thrown errors
 * into problem-details responses. An `ApiError` is sent as it is; anything else is logged
 * and answered with `internal_error`, with none of its content.
 */
export function route<Context = unknown>(
  handler: RouteHandler<Context>,
  { logError = console.error }: RouteOptions = {},
): (request: Request, context: Context) => Promise<Response> {
  return async (request, context) => {
    // Always generated here: an id supplied by the client would let it write into logs.
    const requestId = crypto.randomUUID();

    let response: Response;
    try {
      response = await handler(request, context);
    } catch (error) {
      if (error instanceof ApiError) {
        response = problemResponse(error, requestId);
      } else {
        const reason = error instanceof Error ? `${error.name}: ${error.message}` : "unknown error";
        logError(`Request ${requestId} failed: ${reason}`);
        response = problemResponse(internalError(), requestId);
      }
    }

    // Copied because the headers of a response created elsewhere may be immutable.
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store");
    headers.set("X-Request-Id", requestId);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}

/** Copies only the `Set-Cookie` headers of `source` onto `response`, which must be mutable. */
function withCookies(response: Response, source: Headers | undefined): Response {
  for (const cookie of source?.getSetCookie() ?? []) {
    response.headers.append("Set-Cookie", cookie);
  }
  return response;
}

/**
 * A JSON success response. `cookies` is a set of headers (for example from Better Auth)
 * whose `Set-Cookie` entries are added to the response; nothing else is copied.
 */
export function json(body: unknown, status = 200, cookies?: Headers): Response {
  return withCookies(Response.json(body, { status }), cookies);
}

/** A `204 No Content` response, with the `Set-Cookie` entries of `cookies` if given. */
export function noContent(cookies?: Headers): Response {
  return withCookies(new Response(null, { status: 204 }), cookies);
}

function dotted(path: readonly PropertyKey[]): string {
  return path.map(String).join(".");
}

/**
 * One entry per failing field. Messages are Zod's own, which describe the expectation
 * and never repeat the value that was sent.
 */
function fieldErrors(error: z.ZodError): FieldError[] {
  return error.issues.flatMap((issue): FieldError[] => {
    if (issue.code === "unrecognized_keys") {
      return issue.keys.map((key) => ({
        path: dotted([...issue.path, key]),
        message: "Unknown field",
      }));
    }
    return [{ path: dotted(issue.path), message: issue.message }];
  });
}

function validate<Schema extends z.ZodType>(
  input: unknown,
  schema: Schema,
  detail: string,
): z.output<Schema> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw invalidRequest(fieldErrors(result.error), detail);
  }
  return result.data;
}

function isJson(request: Request): boolean {
  const mediaType = request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase();
  return mediaType === "application/json";
}

/** Reads and validates a JSON request body. Throws `415` or `400` (`ApiError`). */
export async function readJson<Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
): Promise<z.output<Schema>> {
  if (!isJson(request)) {
    throw unsupportedMediaType();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw invalidRequest(undefined, "The request body is not valid JSON.");
  }
  return validate(body, schema, "The request body is not valid.");
}

/**
 * Validates the query string. A parameter given once is a string, a repeated one is a
 * list of strings; the schema coerces from there. Throws `400` (`ApiError`).
 */
export function readQuery<Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
): z.output<Schema> {
  const { searchParams } = new URL(request.url);
  const query: Record<string, string | string[]> = {};
  for (const name of new Set(searchParams.keys())) {
    const values = searchParams.getAll(name);
    query[name] = values.length === 1 ? (values[0] ?? "") : values;
  }
  return validate(query, schema, "The query string is not valid.");
}

/** Validates the path parameters Next.js passes to a route handler. Throws `400`. */
export async function readParams<Schema extends z.ZodType>(
  params: Promise<unknown>,
  schema: Schema,
): Promise<z.output<Schema>> {
  return validate(await params, schema, "The request path is not valid.");
}
