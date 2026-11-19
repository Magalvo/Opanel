import { z } from "zod";
import { createDocument } from "zod-openapi";

import { PROBLEM_CONTENT_TYPE, problemSchema } from "@/lib/schemas/problem";
import { SESSION_COOKIE_NAMES } from "@/lib/session-cookie";

import packageJson from "../../../package.json";
import type { EndpointContract, ResponseContract } from "./contract";
import { contracts } from "./contracts";

type OpenApiDocument = ReturnType<typeof createDocument>;
type Paths = NonNullable<Parameters<typeof createDocument>[0]["paths"]>;
type PathItem = NonNullable<Paths[string]>;
type Operation = NonNullable<PathItem["get"]>;

type Responses = NonNullable<Operation["responses"]>;
type StatusCode = `${1 | 2 | 3 | 4 | 5}${string}`;

/** Added to every operation that needs credentials (canonical doc 0004, section 7). */
const CREDENTIAL_RESPONSES: Readonly<Record<number, ResponseContract>> = {
  401: { description: "No valid credentials were sent.", problem: true },
  403: { description: "The actor lacks the permission or scope.", problem: true },
};

/**
 * The per-token rate limit, which `route()` applies before any other check to every
 * operation a token may call (WS-072, documented by WS-083).
 */
const TOKEN_RATE_LIMITED = "The API token made too many requests (code `rate_limited`).";

/** Every `429` says how long to wait (WS-083). */
const RETRY_AFTER = z.object({
  "Retry-After": z.int().min(1).meta({ description: "Whole seconds to wait before trying again." }),
});

/**
 * How a person's browser authenticates (canonical doc 0004, section 7), and how an agent
 * does: its API token, as a bearer token (WS-072, declared by WS-075).
 */
const SESSION_COOKIE_SCHEME = "sessionCookie";
const BEARER_SCHEME = "bearerAuth";
const [SESSION_COOKIE, SECURE_SESSION_COOKIE] = SESSION_COOKIE_NAMES;

/** One conflict schema per entity schema, so each is registered under its name only once. */
const conflictSchemas = new WeakMap<z.ZodType, z.ZodType>();

/** `Problem` with `code: "version_conflict"` and the entity as `current` (WS-027). */
function versionConflictSchema(entity: z.ZodType): z.ZodType {
  const known = conflictSchemas.get(entity);
  if (known) return known;

  const id = entity.meta()?.id;
  if (id === undefined) {
    throw new Error("A version conflict needs an entity schema with an id: add .meta({ id }).");
  }
  const schema = problemSchema
    .extend({ code: z.literal("version_conflict"), current: entity })
    .meta({ id: `${id}VersionConflict` });
  conflictSchemas.set(entity, schema);
  return schema;
}

function toResponse(response: ResponseContract, status: string): Responses[StatusCode] {
  const documented = toBody(response);
  return status === "429" ? { ...documented, headers: RETRY_AFTER } : documented;
}

function toBody(response: ResponseContract): Responses[StatusCode] {
  if ("noContent" in response) {
    return { description: response.description };
  }
  if ("eventStream" in response) {
    return {
      description: response.description,
      content: { "text/event-stream": { schema: response.eventStream } },
    };
  }
  if ("conflictOf" in response) {
    const conflict = versionConflictSchema(response.conflictOf);
    // anyOf, not oneOf: a version conflict is a Problem too (WS-083).
    return {
      description: response.description,
      content: {
        [PROBLEM_CONTENT_TYPE]: {
          schema: response.otherCodes.length === 0 ? conflict : z.union([conflict, problemSchema]),
        },
      },
    };
  }
  return {
    description: response.description,
    content:
      "problem" in response
        ? { [PROBLEM_CONTENT_TYPE]: { schema: problemSchema } }
        : { "application/json": { schema: response.schema } },
  };
}

/** The token's `429`, added to an operation's own `429` when it has one. */
function withTokenLimit(own: ResponseContract | undefined): ResponseContract {
  if (own === undefined) return { description: TOKEN_RATE_LIMITED, problem: true };
  return { ...own, description: `${own.description} ${TOKEN_RATE_LIMITED}` };
}

function toOperation(contract: EndpointContract): Operation {
  const isPublic = contract.access.kind === "public";
  const byToken = !isPublic && contract.access.kind !== "session";
  const all: Record<number, ResponseContract> = isPublic
    ? { ...contract.responses }
    : { ...CREDENTIAL_RESPONSES, ...contract.responses };
  if (byToken) all[429] = withTokenLimit(contract.responses[429]);
  const responses: Responses = {};
  for (const [status, response] of Object.entries(all)) {
    responses[status as StatusCode] = toResponse(response, status);
  }

  const { params, query, body } = contract.request ?? {};
  const permission = contract.access.kind === "permission" ? contract.access.permission : undefined;
  const description = [
    contract.description,
    permission === undefined ? undefined : `Requires the \`${permission}\` permission.`,
    contract.access.kind === "session" ? "Not available to API tokens." : undefined,
  ]
    .filter((part) => part !== undefined)
    .join("\n\n");

  return {
    summary: contract.summary,
    ...(description === "" ? {} : { description }),
    // Agent authors (WT-05) need to know which permission or scope an operation needs.
    ...(permission === undefined ? {} : { "x-opanel-permission": permission }),
    // An empty list means "no credentials required" for this operation.
    // Either credential, except on the `session` operations, which refuse a token (WS-072).
    security: isPublic
      ? []
      : byToken
        ? [{ [SESSION_COOKIE_SCHEME]: [] }, { [BEARER_SCHEME]: [] }]
        : [{ [SESSION_COOKIE_SCHEME]: [] }],
    ...(params === undefined && query === undefined
      ? {}
      : {
          requestParams: {
            ...(params === undefined ? {} : { path: params }),
            ...(query === undefined ? {} : { query }),
          },
        }),
    ...(body === undefined
      ? {}
      : { requestBody: { required: true, content: { "application/json": { schema: body } } } }),
    responses,
  };
}

/** Builds the OpenAPI 3.1 description of the API from the endpoint contracts. */
export function buildOpenApiDocument(
  endpoints: readonly EndpointContract[] = contracts,
): OpenApiDocument {
  const paths: Paths = {};
  for (const contract of endpoints) {
    const item: PathItem = paths[contract.path] ?? {};
    item[contract.method] = toOperation(contract);
    paths[contract.path] = item;
  }

  return createDocument({
    openapi: "3.1.0",
    info: {
      title: "Opanel API",
      version: packageJson.version,
      description:
        "Opanel is an open-source project management tool for human teams and AI agents. " +
        "Agent authors: see docs/agents.md in the repository.",
      license: { name: "MIT", identifier: "MIT" },
    },
    servers: [{ url: "/" }],
    paths,
    components: {
      securitySchemes: {
        [SESSION_COOKIE_SCHEME]: {
          type: "apiKey",
          in: "cookie",
          name: SESSION_COOKIE,
          description:
            "The session cookie set by `POST /api/v1/auth/sign-in`. When Opanel is served " +
            `over https the cookie is named \`${SECURE_SESSION_COOKIE}\`.`,
        },
        [BEARER_SCHEME]: {
          type: "http",
          scheme: "bearer",
          description:
            "An agent's API token, `opk_…`, created by an Admin (canonical doc 0001 section 4). " +
            "It reaches what the agent's scopes and projects allow.",
        },
      },
    },
  });
}
