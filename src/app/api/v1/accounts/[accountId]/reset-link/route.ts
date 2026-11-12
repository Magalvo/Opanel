import { accountIdParamsSchema } from "@/lib/schemas/accounts";
import { requirePermission } from "@/server/auth/actor";
import { authenticate } from "@/server/auth/authenticate";
import { assertSameOrigin } from "@/server/auth/origin";
import { getEnv } from "@/server/env";
import { json, readParams, route } from "@/server/http/route";
import { issueResetLink } from "@/server/services/account-management";

// Authenticated, and needs accounts:manage (WS-018).
export const dynamic = "force-dynamic";

export const POST = route(async (request, context: { params: Promise<unknown> }) => {
  assertSameOrigin(request, getEnv().APP_URL);
  const { actor, headers } = await authenticate(request);
  requirePermission(actor, "accounts:manage");
  const { accountId } = await readParams(context.params, accountIdParamsSchema);

  return json(await issueResetLink(actor, accountId), 201, headers);
});
