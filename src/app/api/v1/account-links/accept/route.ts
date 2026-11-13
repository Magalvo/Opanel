import { acceptLinkRequestSchema } from "@/lib/schemas/auth";
import { assertSameOrigin } from "@/server/auth/origin";
import { getEnv } from "@/server/env";
import { clientIpFrom } from "@/server/http/client-ip";
import { json, readJson, route } from "@/server/http/route";
import { acceptLink } from "@/server/services/accept-link";

// Public (WS-019): the person has no session and the one-time token is the credential. Every
// refusal is the same 404, so it reveals nothing about links.
export const dynamic = "force-dynamic";

export const POST = route(async (request) => {
  const env = getEnv();
  assertSameOrigin(request, env.APP_URL);
  const body = await readJson(request, acceptLinkRequestSchema);

  const { account, headers } = await acceptLink({
    ...body,
    clientIp: clientIpFrom(request, env.CLIENT_IP_HEADER),
    headers: request.headers,
  });
  return json(account, 200, headers);
});
