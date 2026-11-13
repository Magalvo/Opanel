import { accountIdParamsSchema } from "@/lib/schemas/accounts";
import { requirePermission } from "@/server/auth/actor";
import { authenticate } from "@/server/auth/authenticate";
import { assertSameOrigin } from "@/server/auth/origin";
import { getEnv } from "@/server/env";
import { noContent, readParams, route } from "@/server/http/route";
import { revokeInvitation } from "@/server/services/account-management";

// Authenticated, and needs accounts:manage (WS-024).
export const dynamic = "force-dynamic";

export const DELETE = route(async (request, context: { params: Promise<unknown> }) => {
  assertSameOrigin(request, getEnv().APP_URL);
  const { actor, headers } = await authenticate(request);
  requirePermission(actor, "accounts:manage");
  const { accountId } = await readParams(context.params, accountIdParamsSchema);

  await revokeInvitation(actor, accountId);
  return noContent(headers);
});
