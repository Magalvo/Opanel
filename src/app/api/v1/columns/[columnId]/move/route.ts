import {
  columnParamsSchema,
  moveColumnContract,
  moveColumnRequestSchema,
} from "@/lib/schemas/columns";
import { json, readJson, readParams, route } from "@/server/http/route";
import { moveColumn } from "@/server/services/columns";

export const dynamic = "force-dynamic";

export const POST = route(
  moveColumnContract,
  async (request, context: { params: Promise<unknown> }, { actor }) => {
    const { columnId } = await readParams(context.params, columnParamsSchema);
    const body = await readJson(request, moveColumnRequestSchema);

    return json(await moveColumn(actor, columnId, body));
  },
);
