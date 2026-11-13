import {
  columnParamsSchema,
  deleteColumnContract,
  updateColumnContract,
  updateColumnRequestSchema,
} from "@/lib/schemas/columns";
import { json, noContent, readJson, readParams, route } from "@/server/http/route";
import { deleteColumn, updateColumn } from "@/server/services/columns";

export const dynamic = "force-dynamic";

interface Context {
  params: Promise<unknown>;
}

export const PATCH = route(updateColumnContract, async (request, context: Context, { actor }) => {
  const { columnId } = await readParams(context.params, columnParamsSchema);
  const body = await readJson(request, updateColumnRequestSchema);

  return json(await updateColumn(actor, columnId, body));
});

export const DELETE = route(deleteColumnContract, async (_request, context: Context, { actor }) => {
  const { columnId } = await readParams(context.params, columnParamsSchema);

  await deleteColumn(actor, columnId);
  return noContent();
});
