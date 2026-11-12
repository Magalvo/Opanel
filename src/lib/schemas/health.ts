import { z } from "zod";

import type { EndpointContract } from "@/lib/openapi/contract";

/** Body of `GET /api/v1/health`. Deliberately minimal: the endpoint is public. */
export const healthResponseSchema = z
  .strictObject({
    status: z.enum(["ok", "degraded"]),
    database: z.enum(["up", "down"]),
  })
  .meta({
    id: "HealthResponse",
    description: "Whether the service can do its job. `degraded` means the database is down.",
  });

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const healthContract = {
  method: "get",
  path: "/api/v1/health",
  summary: "Service health",
  description: "Reports whether the service can reach its database. Requires no credentials.",
  public: true,
  responses: {
    200: {
      description: "The service and its database are available.",
      schema: healthResponseSchema,
    },
    503: {
      description: "The database is unavailable.",
      schema: healthResponseSchema,
    },
  },
} satisfies EndpointContract;
