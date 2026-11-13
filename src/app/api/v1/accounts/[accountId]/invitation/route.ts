import { accountIdParamsSchema, revokeInvitationContract } from "@/lib/schemas/accounts";
import { noContent, readParams, route } from "@/server/http/route";
import { revokeInvitation } from "@/server/services/account-management";

export const dynamic = "force-dynamic";

export const DELETE = route(
  revokeInvitationContract,
  async (_request, context: { params: Promise<unknown> }, { actor }) => {
    const { accountId } = await readParams(context.params, accountIdParamsSchema);

    await revokeInvitation(actor, accountId);
    return noContent();
  },
);
