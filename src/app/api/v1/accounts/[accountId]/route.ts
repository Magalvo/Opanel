import {
  accountIdParamsSchema,
  updateAccountContract,
  updateAccountRequestSchema,
} from "@/lib/schemas/accounts";
import { json, readJson, readParams, route } from "@/server/http/route";
import { updateAccount } from "@/server/services/account-management";

export const dynamic = "force-dynamic";

export const PATCH = route(
  updateAccountContract,
  async (request, context: { params: Promise<unknown> }, { actor }) => {
    const { accountId } = await readParams(context.params, accountIdParamsSchema);
    const body = await readJson(request, updateAccountRequestSchema);

    return json(await updateAccount(actor, accountId, body));
  },
);
