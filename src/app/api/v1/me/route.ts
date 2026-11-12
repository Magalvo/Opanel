import { authenticate } from "@/server/auth/authenticate";
import { json, route } from "@/server/http/route";
import { summarize } from "@/server/services/sign-in";

// Authenticated, no permission: it describes the caller (WS-015).
export const dynamic = "force-dynamic";

export const GET = route(async (request) => {
  const { actor, account, headers } = await authenticate(request);

  return json({ ...summarize(account), permissions: [...actor.permissions].sort() }, 200, headers);
});
