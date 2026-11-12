import { createDocument } from "zod-openapi";

import packageJson from "../../../package.json";
import type { EndpointContract } from "./contract";
import { contracts } from "./contracts";

type OpenApiDocument = ReturnType<typeof createDocument>;
type Paths = NonNullable<Parameters<typeof createDocument>[0]["paths"]>;
type PathItem = NonNullable<Paths[string]>;
type Operation = NonNullable<PathItem["get"]>;

function toOperation(contract: EndpointContract): Operation {
  const responses: Operation["responses"] = {};
  for (const [status, response] of Object.entries(contract.responses)) {
    responses[status as `${1 | 2 | 3 | 4 | 5}${string}`] = {
      description: response.description,
      content: { "application/json": { schema: response.schema } },
    };
  }

  return {
    summary: contract.summary,
    ...(contract.description === undefined ? {} : { description: contract.description }),
    // An empty list means "no credentials required" for this operation.
    ...(contract.public ? { security: [] } : {}),
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
