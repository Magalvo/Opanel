import { z } from "zod";

/** Body of `GET /api/v1/health`. Deliberately minimal: the endpoint is public. */
export const healthResponseSchema = z.strictObject({
  status: z.enum(["ok", "degraded"]),
  database: z.enum(["up", "down"]),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
