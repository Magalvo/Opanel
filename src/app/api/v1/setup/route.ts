import { setupContract, setupRequestSchema } from "@/lib/schemas/auth";
import { getEnv } from "@/server/env";
import { clientIpFrom } from "@/server/http/client-ip";
import { json, readJson, route } from "@/server/http/route";
import { createFirstAdmin } from "@/server/services/setup";

// Public (WS-016): before the first account exists there is nobody to authenticate. Once
// any account exists it is a plain 404, the same as an unknown path.
export const dynamic = "force-dynamic";

export const POST = route(setupContract, async (request) => {
  const body = await readJson(request, setupRequestSchema);

  const { account, headers, signedIn } = await createFirstAdmin({
    ...body,
    clientIp: clientIpFrom(request, getEnv().CLIENT_IP_HEADER),
    headers: request.headers,
  });
  // No cookie when `signedIn` is false: the Admin exists, they sign in (WS-057).
  return json({ ...account, signedIn }, 201, headers);
});
