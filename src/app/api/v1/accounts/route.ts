import {
  inviteAccountContract,
  inviteRequestSchema,
  listAccountsContract,
} from "@/lib/schemas/accounts";
import { paginationQuerySchema } from "@/lib/schemas/pagination";
import { json, readJson, readQuery, route } from "@/server/http/route";
import { inviteAccount, listAccounts } from "@/server/services/account-management";

export const dynamic = "force-dynamic";

export const GET = route(listAccountsContract, async (request, _context, { actor }) => {
  const query = readQuery(request, paginationQuerySchema);

  return json(await listAccounts(actor, query));
});

export const POST = route(inviteAccountContract, async (request, _context, { actor }) => {
  const body = await readJson(request, inviteRequestSchema);

  return json(await inviteAccount(actor, body), 201);
});
