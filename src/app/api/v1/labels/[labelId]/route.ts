import {
  deleteLabelContract,
  labelParamsSchema,
  updateLabelContract,
  updateLabelRequestSchema,
} from "@/lib/schemas/labels";
import { json, noContent, readJson, readParams, route } from "@/server/http/route";
import { deleteLabel, updateLabel } from "@/server/services/labels";

export const dynamic = "force-dynamic";

interface Context {
  params: Promise<unknown>;
}

export const PATCH = route(updateLabelContract, async (request, context: Context, { actor }) => {
  const { labelId } = await readParams(context.params, labelParamsSchema);
  const body = await readJson(request, updateLabelRequestSchema);

  return json(await updateLabel(actor, labelId, body));
});

export const DELETE = route(deleteLabelContract, async (_request, context: Context, { actor }) => {
  const { labelId } = await readParams(context.params, labelParamsSchema);

  await deleteLabel(actor, labelId);
  return noContent();
});
