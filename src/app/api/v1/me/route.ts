import { updateMeRequestSchema } from "@/lib/schemas/auth";
import type { Actor } from "@/server/auth/actor";
import { authenticate } from "@/server/auth/authenticate";
import { assertSameOrigin } from "@/server/auth/origin";
import { getEnv } from "@/server/env";
import { json, readJson, route } from "@/server/http/route";
import type { AccountRow } from "@/server/services/accounts";
import { renameSelf } from "@/server/services/profile";
import { summarize } from "@/server/services/sign-in";

// Authenticated, no permission: both describe or change the caller (WS-015, WS-021).
export const dynamic = "force-dynamic";

function me(actor: Actor, account: AccountRow) {
  return { ...summarize(account), permissions: [...actor.permissions].sort() };
}

export const GET = route(async (request) => {
  const { actor, account, headers } = await authenticate(request);

  return json(me(actor, account), 200, headers);
});

export const PATCH = route(async (request) => {
  assertSameOrigin(request, getEnv().APP_URL);
  const { actor, headers } = await authenticate(request);
  const { name } = await readJson(request, updateMeRequestSchema);

  return json(me(actor, await renameSelf(actor, name)), 200, headers);
});
