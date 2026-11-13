import { changePasswordRequestSchema } from "@/lib/schemas/auth";
import { authenticate } from "@/server/auth/authenticate";
import { assertSameOrigin } from "@/server/auth/origin";
import { getEnv } from "@/server/env";
import { noContent, readJson, route } from "@/server/http/route";
import { changeOwnPassword } from "@/server/services/profile";

// Authenticated, no permission: it changes the caller's own password (WS-021).
export const dynamic = "force-dynamic";

export const POST = route(async (request) => {
  assertSameOrigin(request, getEnv().APP_URL);
  const { actor, sessionId, headers } = await authenticate(request);
  const body = await readJson(request, changePasswordRequestSchema);

  await changeOwnPassword(actor, { sessionId, ...body });
  return noContent(headers);
});
