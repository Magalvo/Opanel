import { setupRequestSchema } from "@/lib/schemas/auth";
import { assertSameOrigin } from "@/server/auth/origin";
import { getEnv } from "@/server/env";
import { clientIpFrom } from "@/server/http/client-ip";
import { json, readJson, route } from "@/server/http/route";
import { createFirstAdmin } from "@/server/services/setup";

// Public (WS-016): before the first account exists there is nobody to authenticate. Once
// any account exists it is a plain 404, the same as an unknown path.
export const dynamic = "force-dynamic";

export const POST = route(async (request) => {
  const env = getEnv();
  assertSameOrigin(request, env.APP_URL);
  const body = await readJson(request, setupRequestSchema);

  const { account, headers } = await createFirstAdmin({
    ...body,
    clientIp: clientIpFrom(request, env.CLIENT_IP_HEADER),
    headers: request.headers,
  });
  return json(account, 201, headers);
});
