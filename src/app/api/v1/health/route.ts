import { getDb } from "@/server/db/client";
import { checkHealth } from "@/server/services/health";

// Public endpoint (WS-005): no authentication, and the body exposes no internal detail.
// Always computed per request, never at build time.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const health = await checkHealth(getDb());

  return Response.json(health, {
    status: health.status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
