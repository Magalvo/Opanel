import { authenticate } from "@/server/auth/authenticate";
import { assertSameOrigin } from "@/server/auth/origin";
import { getEnv } from "@/server/env";
import { noContent, route } from "@/server/http/route";
import { signOut } from "@/server/services/sign-in";

// Authenticated, no permission: it acts on the caller's own session (WS-015).
export const dynamic = "force-dynamic";

export const POST = route(async (request) => {
  assertSameOrigin(request, getEnv().APP_URL);
  const { actor } = await authenticate(request);

  return noContent(await signOut({ actor, headers: request.headers }));
});
