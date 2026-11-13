import { meContract, updateMeContract, updateMeRequestSchema } from "@/lib/schemas/auth";
import type { Actor } from "@/server/auth/actor";
import { json, readJson, route } from "@/server/http/route";
import type { AccountRow } from "@/server/services/accounts";
import { renameSelf } from "@/server/services/profile";
import { summarize } from "@/server/services/sign-in";

// Authentication only (WS-015, WS-021): both describe or change the caller.
export const dynamic = "force-dynamic";

function me(actor: Actor, account: AccountRow) {
  return { ...summarize(account), permissions: [...actor.permissions].sort() };
}

export const GET = route(meContract, (_request, _context, { actor, account }) =>
  json(me(actor, account)),
);

export const PATCH = route(updateMeContract, async (request, _context, { actor }) => {
  const { name } = await readJson(request, updateMeRequestSchema);

  return json(me(actor, await renameSelf(actor, name)));
});
