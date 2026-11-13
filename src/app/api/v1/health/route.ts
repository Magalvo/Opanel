import { healthContract } from "@/lib/schemas/health";
import { getDb } from "@/server/db/client";
import { route } from "@/server/http/route";
import { checkHealth } from "@/server/services/health";

// Public endpoint (WS-005): no authentication, and the body exposes no internal detail.
// Always computed per request, never at build time. Its 503 keeps the health body.
export const dynamic = "force-dynamic";

export const GET = route(healthContract, async () => {
  const health = await checkHealth(getDb());

  return Response.json(health, { status: health.status === "ok" ? 200 : 503 });
});
