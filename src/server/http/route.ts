import type { z } from "zod";

import type { EndpointContract } from "@/lib/openapi/contract";
import { type FieldError, type Problem, PROBLEM_CONTENT_TYPE } from "@/lib/schemas/problem";
import { strictTransportSecurity } from "@/lib/security-headers";
import { requirePermission } from "@/server/auth/actor";
import {
  authenticate,
  type Authenticated,
  type SessionAuthenticated,
} from "@/server/auth/authenticate";
import {
  type FailedTokenLimiter,
  failedTokenKey,
  getFailedTokenLimiter,
} from "@/server/auth/failed-token-limit";
import { assertSameOrigin } from "@/server/auth/origin";
import { getTokenRateLimiter, type TokenRateLimiter } from "@/server/auth/token-rate-limit";
import { getEnv } from "@/server/env";

import {
  ApiError,
  forbidden,
  internalError,
  invalidRequest,
  payloadTooLarge,
  rateLimited,
  unsupportedMediaType,
} from "./errors";
import { describeError } from "./safe-error";

export type RouteHandler<Context> = (
  request: Request,
  context: Context,
) => Response | Promise<Response>;

/** What a handler is given about the caller: nothing for a public operation. */
export type AuthFor<Contract extends EndpointContract> = Contract["access"] extends {
  kind: "public";
}
  ? undefined
  : Contract["access"] extends { kind: "session" }
    ? SessionAuthenticated
    : Authenticated;

export type ContractHandler<Contract extends EndpointContract, Context> = (
  request: Request,
  context: Context,
  auth: AuthFor<Contract>,
) => Response | Promise<Response>;

/** A wrapped handler, carrying the contract it enforces (read by the guard-rail test). */
export interface ContractRoute<Context> {
  (request: Request, context: Context): Promise<Response>;
  readonly contract: EndpointContract;
}

export interface RouteOptions {
  /** Counts requests per API token (WS-072). Defaults to the process's limiter. */
  tokenRateLimiter?: TokenRateLimiter;
  /** Counts failed token attempts per client address (WS-125). Defaults to the process's. */
  failedTokenLimiter?: FailedTokenLimiter;
  /**
   * The header holding the client address; `null` when none is trusted. Defaults to
   * `CLIENT_IP_HEADER`, read per request.
   */
  clientIpHeader?: string | null;
  /** Receives a description of an unexpected failure. Never part of the response. */
  logError?: (message: string) => void;
  /** The app's own origin, for the same-origin check. Defaults to `APP_URL`, read per request. */
  appUrl?: string;
}

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function problemResponse(error: ApiError, requestId: string): Response {
  const problem: Problem = {
    type: "about:blank",
    title: error.title,
    status: error.status,
    code: error.code,
    detail: error.detail,
    requestId,
    ...(error.errors === undefined ? {} : { errors: [...error.errors] }),
    ...(error.current === undefined ? {} : { current: error.current }),
  };
  const headers = new Headers({ "Content-Type": PROBLEM_CONTENT_TYPE });
  if (error.retryAfterSeconds !== undefined) {
    headers.set("Retry-After", String(error.retryAfterSeconds));
  }
  return new Response(JSON.stringify(problem), { status: error.status, headers });
}

/**
 * The behaviour every API response shares (canonical doc 0004): a request id,
 * `Cache-Control: no-store`, and the conversion of thrown errors into problem-details
 * responses. An `ApiError` is sent as it is; anything else is logged and answered with
 * `internal_error`, with none of its content.
 */
function withSharedBehaviour<Context>(
  handler: RouteHandler<Context>,
  logError: (message: string) => void,
  appUrl: string | undefined,
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
        // Never the message: a failed query's message holds its parameters (WS-042).
        logError(`Request ${requestId} failed: ${describeError(error)}`);
        response = problemResponse(internalError(), requestId);
      }
    }

    // Copied because the headers of a response created elsewhere may be immutable.
    const headers = new Headers(response.headers);
    // A handler may add directives to no-store (the event stream adds no-transform, WS-047),
    // never weaken it.
    if (!/(?:^|,)\s*no-store\s*(?:,|$)/.test(headers.get("Cache-Control") ?? "")) {
      headers.set("Cache-Control", "no-store");
    }
    headers.set("X-Request-Id", requestId);
    // Only on an install served over HTTPS (WS-067).
    const hsts = strictTransportSecurity(appUrl ?? getEnv().APP_URL);
    if (hsts !== null) headers.set("Strict-Transport-Security", hsts);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}

/**
 * Wraps the handler of one API operation (WS-025). Before the handler runs, and in this
 * order: a state-changing request must come from the app's own origin (`403`); unless the
 * contract is public, the caller is authenticated (`401`); if the contract names a
 * permission, the caller must hold it (`403`); an operation whose contract declares no
 * query refuses any query parameter (`400`, WS-083). The handler then receives the
 * authenticated caller, or `undefined` for a public operation. Object-level rules stay in
 * the services.
 *
 * When authentication produced `Set-Cookie` headers (an extended session), they are added
 * to the handler's response, unless the handler set cookies of its own.
 */
export function route<const Contract extends EndpointContract, Context = unknown>(
  contract: Contract,
  handler: ContractHandler<Contract, Context>,
  {
    logError = console.error,
    appUrl,
    tokenRateLimiter,
    failedTokenLimiter,
    clientIpHeader,
  }: RouteOptions = {},
): ContractRoute<Context> {
  const wrapped = withSharedBehaviour<Context>(
    async (request, context) => {
      if (STATE_CHANGING_METHODS.has(request.method)) {
        assertSameOrigin(request, appUrl ?? getEnv().APP_URL);
      }

      if (contract.access.kind === "public") {
        refuseUndeclaredQuery(contract, request);
        // AuthFor<Contract> is undefined exactly when the access is public.
        return handler(request, context, undefined as AuthFor<Contract>);
      }

      const auth = await authenticateLimited(request, {
        limiter: failedTokenLimiter ?? getFailedTokenLimiter(),
        headerName: clientIpHeader === undefined ? getEnv().CLIENT_IP_HEADER : clientIpHeader,
        logError,
      });
      if (auth.via === "token") {
        // Per token, after authentication (WT-05 decision 8, WS-072 question 3).
        const decision = (tokenRateLimiter ?? getTokenRateLimiter()).hit(auth.tokenId);
        if (!decision.allowed) throw rateLimited(decision.retryAfterSeconds);
        if (contract.access.kind === "session") throw forbidden();
      }
      if (contract.access.kind === "permission") {
        requirePermission(auth.actor, contract.access.permission);
      }
      refuseUndeclaredQuery(contract, request);

      const response = await handler(request, context, auth as AuthFor<Contract>);
      if (response.headers.getSetCookie().length > 0) {
        return response;
      }
      return withCookies(new Response(response.body, response), auth.headers);
    },
    logError,
    appUrl,
  );

  return Object.assign(wrapped, { contract });
}

/**
 * `authenticate()`, with failed token attempts limited per trusted client address (WS-125):
 * past the limit, a token request is refused with `429` before its token is looked up. Only
 * a `401` stays counted. Session requests are not counted, nor are the event stream's
 * heartbeat checks, which call `authenticate()` directly.
 */
async function authenticateLimited(
  request: Request,
  {
    limiter,
    headerName,
    logError,
  }: {
    limiter: FailedTokenLimiter;
    headerName: string | null | undefined;
    logError: (message: string) => void;
  },
): Promise<Authenticated> {
  const key = request.headers.has("Authorization")
    ? failedTokenKey(request, headerName ?? undefined)
    : null;
  if (key === null) return authenticate(request);

  const decision = limiter.begin(key);
  if (!decision.allowed) {
    if (decision.firstRefusal) {
      const source = key.startsWith("ip") ? key.slice(key.indexOf(":") + 1) : `"${key}"`;
      logError(
        `Failed API token attempts from ${source} reached the limit; refusing them for ` +
          `${String(decision.retryAfterSeconds)} s.`,
      );
    }
    throw rateLimited(decision.retryAfterSeconds);
  }
  try {
    const auth = await authenticate(request);
    decision.succeeded();
    return auth;
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 401)) decision.succeeded();
    throw error;
  }
}

/**
 * An operation that declares no query takes none (canonical doc 0004 section 3, WS-083):
 * any parameter is a `400` naming it. Operations that declare one validate it themselves
 * with `readQuery`.
 */
function refuseUndeclaredQuery(contract: EndpointContract, request: Request): void {
  if (contract.request?.query !== undefined) return;
  const names = [...new Set(new URL(request.url).searchParams.keys())];
  if (names.length === 0) return;
  throw invalidRequest(
    names.map((name) => ({ path: name, message: "Unknown field" })),
    "The query string is not valid.",
  );
}

/**
 * For the catch-all of unknown API paths only (WS-011), which is not an operation and has
 * no contract: the shared headers and error conversion, no checks.
 */
export function unknownPathRoute<Context = unknown>(
  handler: RouteHandler<Context>,
  { logError = console.error, appUrl }: RouteOptions = {},
): (request: Request, context: Context) => Promise<Response> {
  return withSharedBehaviour(handler, logError, appUrl);
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

/**
 * The most bytes a JSON request body may have (WS-044): 512 KiB, which covers the largest
 * field today (a 50 000-character description is at most 300 000 bytes as JSON) with room.
 */
export const MAX_JSON_BODY_BYTES = 512 * 1024;

/** A `Content-Length` that is a plain non-negative integer, or `null` for anything else. */
function declaredLength(request: Request): number | null {
  const value = request.headers.get("Content-Length")?.trim() ?? "";
  return /^\d+$/.test(value) ? Number(value) : null;
}

/**
 * The body's bytes, counted as they arrive: `413` as soon as they pass the budget, whatever
 * `Content-Length` says; `400` if the body breaks off.
 */
async function readBounded(request: Request): Promise<Uint8Array> {
  const declared = declaredLength(request);
  if (declared !== null && declared > MAX_JSON_BODY_BYTES) {
    await request.body?.cancel().catch(() => undefined);
    throw payloadTooLarge();
  }
  if (request.body === null) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    let result: ReadableStreamReadResult<Uint8Array>;
    try {
      result = await reader.read();
    } catch {
      throw invalidRequest(undefined, "The request body could not be read.");
    }
    if (result.done) break;
    total += result.value.byteLength;
    if (total > MAX_JSON_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw payloadTooLarge();
    }
    chunks.push(result.value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Reads and validates a JSON request body, within the budget of WS-044. Throws `415`, `413`
 * or `400` (`ApiError`), in that order of checks.
 */
export async function readJson<Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
): Promise<z.output<Schema>> {
  if (!isJson(request)) {
    throw unsupportedMediaType();
  }

  const bytes = await readBounded(request);
  let body: unknown;
  try {
    // TextDecoder drops a byte order mark, as request.json() does.
    body = JSON.parse(new TextDecoder("utf-8").decode(bytes));
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
