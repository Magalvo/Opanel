import { inviteRequestSchema } from "@/lib/schemas/accounts";
import { paginationQuerySchema } from "@/lib/schemas/pagination";
import { requirePermission } from "@/server/auth/actor";
import { authenticate } from "@/server/auth/authenticate";
import { assertSameOrigin } from "@/server/auth/origin";
import { getEnv } from "@/server/env";
import { json, readJson, readQuery, route } from "@/server/http/route";
import { inviteAccount, listAccounts } from "@/server/services/account-management";

// Authenticated, and needs accounts:manage (WS-018).
export const dynamic = "force-dynamic";

export const GET = route(async (request) => {
  const { actor, headers } = await authenticate(request);
  requirePermission(actor, "accounts:manage");
  const query = readQuery(request, paginationQuerySchema);

  return json(await listAccounts(actor, query), 200, headers);
});

export const POST = route(async (request) => {
  assertSameOrigin(request, getEnv().APP_URL);
  const { actor, headers } = await authenticate(request);
  requirePermission(actor, "accounts:manage");
  const body = await readJson(request, inviteRequestSchema);

  return json(await inviteAccount(actor, body), 201, headers);
});
