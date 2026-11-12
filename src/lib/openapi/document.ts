import { createDocument } from "zod-openapi";

import { PROBLEM_CONTENT_TYPE, problemSchema } from "@/lib/schemas/problem";

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

function toResponse(response: ResponseContract): Responses[StatusCode] {
  return {
    description: response.description,
    content:
      "problem" in response
        ? { [PROBLEM_CONTENT_TYPE]: { schema: problemSchema } }
        : { "application/json": { schema: response.schema } },
  };
}

function toOperation(contract: EndpointContract): Operation {
  const all = contract.public
    ? contract.responses
    : { ...CREDENTIAL_RESPONSES, ...contract.responses };
  const responses: Responses = {};
  for (const [status, response] of Object.entries(all)) {
    responses[status as StatusCode] = toResponse(response);
  }

  const { params, query, body } = contract.request ?? {};

  return {
    summary: contract.summary,
    ...(contract.description === undefined ? {} : { description: contract.description }),
    // An empty list means "no credentials required" for this operation.
    ...(contract.public ? { security: [] } : {}),
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
        "Opanel is an open-source project management tool for human teams and AI agents.",
      license: { name: "MIT", identifier: "MIT" },
    },
    servers: [{ url: "/" }],
    paths,
  });
}
