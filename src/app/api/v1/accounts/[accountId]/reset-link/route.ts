import { accountIdParamsSchema, resetLinkContract } from "@/lib/schemas/accounts";
import { json, readParams, route } from "@/server/http/route";
import { issueResetLink } from "@/server/services/account-management";

export const dynamic = "force-dynamic";

export const POST = route(
  resetLinkContract,
  async (_request, context: { params: Promise<unknown> }, { actor }) => {
    const { accountId } = await readParams(context.params, accountIdParamsSchema);

    return json(await issueResetLink(actor, accountId), 201);
  },
);
