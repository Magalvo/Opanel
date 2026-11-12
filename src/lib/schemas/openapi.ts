import { z } from "zod";

import type { EndpointContract } from "@/lib/openapi/contract";

export const openApiDocumentSchema = z.record(z.string(), z.unknown()).meta({
  id: "OpenApiDocument",
  description: "An OpenAPI 3.1 document.",
});

export const openApiContract = {
  method: "get",
  path: "/api/v1/openapi.json",
  summary: "API description",
  description: "This document: the OpenAPI 3.1 description of the Opanel API.",
  public: true,
  responses: {
    200: {
      description: "The OpenAPI document.",
      schema: openApiDocumentSchema,
    },
  },
} satisfies EndpointContract;
