import { signInContract, signInRequestSchema } from "@/lib/schemas/auth";
import { getEnv } from "@/server/env";
import { clientIpFrom } from "@/server/http/client-ip";
import { json, readJson, route } from "@/server/http/route";
import { signIn } from "@/server/services/sign-in";

// Public (WS-015): it cannot require credentials. Its failures are all the same 401.
export const dynamic = "force-dynamic";

export const POST = route(signInContract, async (request) => {
  const body = await readJson(request, signInRequestSchema);

  const { account, headers } = await signIn({
    ...body,
    clientIp: clientIpFrom(request, getEnv().CLIENT_IP_HEADER),
    headers: request.headers,
  });
  return json(account, 200, headers);
});
